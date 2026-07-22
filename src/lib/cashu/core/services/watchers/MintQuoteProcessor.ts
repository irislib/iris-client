import type {EventBus, CoreEvents} from "@core/events"
import type {Logger} from "../../logging/Logger.ts"
import type {MintQuoteService} from "../MintQuoteService"
import {MintOperationError, NetworkError, type MintQuoteState} from "@cashu/cashu-ts"

interface QueueItem {
  mintUrl: string
  quoteId: string
  quoteType: string
  retryCount: number
  nextRetryAt: number
}

interface QuoteHandler {
  canHandle(quoteType: string): boolean
  process(mintUrl: string, quoteId: string): Promise<void>
}

class Bolt11QuoteHandler implements QuoteHandler {
  constructor(
    private quotes: MintQuoteService,
    _logger?: Logger
  ) {}

  canHandle(quoteType: string): boolean {
    return quoteType === "bolt11"
  }

  async process(mintUrl: string, quoteId: string): Promise<void> {
    await this.quotes.redeemMintQuote(mintUrl, quoteId)
  }
}

export interface MintQuoteProcessorOptions {
  processIntervalMs?: number
  maxRetries?: number
  baseRetryDelayMs?: number
  initialEnqueueDelayMs?: number
}

export class MintQuoteProcessor {
  private readonly quotes: MintQuoteService
  private readonly bus: EventBus<CoreEvents>
  private readonly logger?: Logger

  private running = false
  private queue: QueueItem[] = []
  private processing = false
  private processingTimer?: ReturnType<typeof setTimeout>
  private offStateChanged?: () => void
  private offQuoteAdded?: () => void
  private offRequeue?: () => void

  private handlers = new Map<string, QuoteHandler>()
  private readonly processIntervalMs: number
  private readonly maxRetries: number
  private readonly baseRetryDelayMs: number
  private readonly initialEnqueueDelayMs: number

  constructor(
    quotes: MintQuoteService,
    bus: EventBus<CoreEvents>,
    logger?: Logger,
    options?: MintQuoteProcessorOptions
  ) {
    this.quotes = quotes
    this.bus = bus
    this.logger = logger

    // Apply options with defaults
    this.processIntervalMs = options?.processIntervalMs ?? 3000
    this.maxRetries = options?.maxRetries ?? 3
    this.baseRetryDelayMs = options?.baseRetryDelayMs ?? 5000
    this.initialEnqueueDelayMs = options?.initialEnqueueDelayMs ?? 500

    // Register default handler for bolt11 quotes
    this.registerHandler("bolt11", new Bolt11QuoteHandler(quotes, logger))
  }

  registerHandler(quoteType: string, handler: QuoteHandler): void {
    this.handlers.set(quoteType, handler)
    this.logger?.debug("Registered quote handler", {quoteType})
  }

  isRunning(): boolean {
    return this.running
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.logger?.info("MintQuoteProcessor started")

    // Subscribe to state changes
    this.offStateChanged = this.bus.on(
      "mint-quote:state-changed",
      async ({mintUrl, quoteId, state}) => {
        if (state === "PAID") {
          this.enqueue(mintUrl, quoteId, "bolt11") // Default to bolt11 for now
        }
      }
    )

    // Subscribe to manually added quotes
    this.offQuoteAdded = this.bus.on(
      "mint-quote:added",
      async ({mintUrl, quoteId, quote}) => {
        if (quote.state === "PAID") {
          // Use provided quoteType or default to bolt11
          this.enqueue(mintUrl, quoteId, "bolt11")
        }
      }
    )

    // Subscribe to explicit requeue events (enqueue regardless of stored state)
    this.offRequeue = this.bus.on("mint-quote:requeue", async ({mintUrl, quoteId}) => {
      this.enqueue(mintUrl, quoteId, "bolt11")
    })

    // Start processing loop
    this.scheduleNextProcess()
  }

  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false

    // Unsubscribe from events
    if (this.offStateChanged) {
      try {
        this.offStateChanged()
      } catch {
        // ignore
      } finally {
        this.offStateChanged = undefined
      }
    }

    if (this.offQuoteAdded) {
      try {
        this.offQuoteAdded()
      } catch {
        // ignore
      } finally {
        this.offQuoteAdded = undefined
      }
    }

    if (this.offRequeue) {
      try {
        this.offRequeue()
      } catch {
        // ignore
      } finally {
        this.offRequeue = undefined
      }
    }

    // Clear processing timer
    if (this.processingTimer) {
      clearTimeout(this.processingTimer)
      this.processingTimer = undefined
    }

    // Wait for current processing to complete
    while (this.processing) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    this.logger?.info("MintQuoteProcessor stopped", {pendingItems: this.queue.length})
  }

  /**
   * Wait for the queue to be empty and all processing to complete.
   * Useful for CLI applications that want to ensure all quotes are processed before exiting.
   */
  async waitForCompletion(): Promise<void> {
    while (this.queue.length > 0 || this.processing) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  // TODO: Improve deduplication by tracking an "active" set keyed by `${mintUrl}::${quoteId}`
  // to prevent re-enqueueing while an item is currently being processed. Today we only
  // deduplicate within the queue, so an item can be enqueued again if a new event arrives
  // during in-flight processing.
  private enqueue(mintUrl: string, quoteId: string, quoteType: string): void {
    // Check if already in queue
    const existing = this.queue.find(
      (item) => item.mintUrl === mintUrl && item.quoteId === quoteId
    )
    if (existing) {
      this.logger?.debug("Quote already in queue", {mintUrl, quoteId})
      return
    }

    const wasEmpty = this.queue.length === 0

    this.queue.push({
      mintUrl,
      quoteId,
      quoteType,
      retryCount: 0,
      nextRetryAt: 0,
    })

    this.logger?.debug("Quote enqueued for processing", {
      mintUrl,
      quoteId,
      quoteType,
      queueLength: this.queue.length,
    })

    // If queue was empty and processor is idle, schedule a faster first run
    if (wasEmpty && this.running && !this.processing) {
      if (this.processingTimer) {
        clearTimeout(this.processingTimer)
        this.processingTimer = undefined
      }
      this.processingTimer = setTimeout(() => {
        this.processingTimer = undefined
        this.processNext()
      }, this.initialEnqueueDelayMs)
    }
  }

  private scheduleNextProcess(): void {
    if (!this.running || this.processingTimer) return

    this.processingTimer = setTimeout(() => {
      this.processingTimer = undefined
      this.processNext()
    }, this.processIntervalMs)
  }

  private async processNext(): Promise<void> {
    if (!this.running || this.processing || this.queue.length === 0) {
      if (this.running) {
        this.scheduleNextProcess()
      }
      return
    }

    // Find next item that's ready to process
    const now = Date.now()
    const readyIndex = this.queue.findIndex((item) => item.nextRetryAt <= now)

    if (readyIndex === -1) {
      // No items ready yet, schedule for when the next one will be
      const nextReady = Math.min(...this.queue.map((item) => item.nextRetryAt))
      const delay = Math.max(this.processIntervalMs, nextReady - now)
      this.processingTimer = setTimeout(() => {
        this.processingTimer = undefined
        this.processNext()
      }, delay)
      return
    }

    // Remove item from queue
    const [item] = this.queue.splice(readyIndex, 1)
    if (!item) {
      // This shouldn't happen, but handle it gracefully
      return
    }
    this.processing = true

    try {
      await this.processItem(item)
    } catch (err) {
      this.handleProcessingError(item, err)
    } finally {
      this.processing = false
      if (this.running) {
        this.scheduleNextProcess()
      }
    }
  }

  private async processItem(item: QueueItem): Promise<void> {
    const {mintUrl, quoteId, quoteType} = item

    const handler = this.handlers.get(quoteType)
    if (!handler) {
      this.logger?.warn("No handler registered for quote type", {
        quoteType,
        mintUrl,
        quoteId,
      })
      return
    }

    this.logger?.info("Processing mint quote", {
      mintUrl,
      quoteId,
      quoteType,
      attempt: item.retryCount + 1,
    })

    await handler.process(mintUrl, quoteId)
    this.logger?.info("Successfully processed mint quote", {
      mintUrl,
      quoteId,
      quoteType,
    })
  }

  private handleProcessingError(item: QueueItem, err: unknown): void {
    const {mintUrl, quoteId} = item

    // Handle specific mint operation errors
    if (err instanceof MintOperationError) {
      if (err.code === 20007) {
        // Quote expired - we can't set it to EXPIRED as that's not a valid state
        // Just log and move on, the quote will remain in its current state
        this.logger?.warn("Mint quote expired", {mintUrl, quoteId})
        return
      } else if (err.code === 20002) {
        // Quote already issued
        this.logger?.info("Mint quote already issued, updating state", {mintUrl, quoteId})
        this.updateQuoteState(mintUrl, quoteId, "ISSUED")
        return
      }
      // Other mint errors - don't retry
      this.logger?.error("Mint operation error, not retrying", {
        mintUrl,
        quoteId,
        code: err.code,
        detail: err.message,
      })
      return
    }

    // Handle network errors with retry
    if (
      err instanceof NetworkError ||
      (err instanceof Error && err.message.includes("network"))
    ) {
      item.retryCount++
      if (item.retryCount <= this.maxRetries) {
        // Calculate exponential backoff
        const delay = this.baseRetryDelayMs * Math.pow(2, item.retryCount - 1)
        item.nextRetryAt = Date.now() + delay

        this.logger?.warn("Network error, will retry", {
          mintUrl,
          quoteId,
          attempt: item.retryCount,
          maxRetries: this.maxRetries,
          retryInMs: delay,
        })

        // Re-add to queue for retry
        this.queue.push(item)
        return
      }

      this.logger?.error("Max retries exceeded for network error", {
        mintUrl,
        quoteId,
        maxRetries: this.maxRetries,
      })
      return
    }

    // Unknown error - log and don't retry
    this.logger?.error("Failed to process mint quote", {mintUrl, quoteId, err})
  }

  private async updateQuoteState(
    mintUrl: string,
    quoteId: string,
    state: MintQuoteState
  ): Promise<void> {
    try {
      await this.quotes.updateStateFromRemote(mintUrl, quoteId, state)
    } catch (err) {
      this.logger?.error("Failed to update quote state", {mintUrl, quoteId, state, err})
    }
  }
}
