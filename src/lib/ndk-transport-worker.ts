/* eslint-disable @typescript-eslint/no-explicit-any */
import type NDK from "./ndk"
import type {NDKEvent} from "./ndk/events"
import {
  NDKSubscriptionCacheUsage,
  type NDKFilter,
  type NDKSubscriptionOptions,
} from "./ndk/subscription"
import type {NDKRelay} from "./ndk/relay"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import type {
  WorkerMessage,
  WorkerResponse,
  WorkerSubscribeOpts,
  LocalDataStats,
  SearchResult,
} from "./ndk-transport-types"
import {useSettingsStore} from "@/stores/settings"

const {log} = createDebugLogger(DEBUG_NAMESPACES.NDK_WORKER)

/**
 * NDK transport that communicates with relay worker
 * All actual WebSocket connections live in the worker thread
 */
export class NDKWorkerTransport {
  public name = "worker-transport"
  private worker: Worker
  private workerUrl?: string
  private workerFactory?: () => Worker
  private ndk?: NDK
  private relayUrls: string[] = []
  private subscriptions = new Map<string, Set<(event: NDKEvent) => void>>()
  private eoseHandlers = new Map<string, Set<() => void>>()
  private publishResolvers = new Map<
    string,
    {resolve: () => void; reject: (err: Error) => void}
  >()
  private ready = false
  private readyPromise!: Promise<void>
  private restartAttempts = 0
  private statsCallbacks = new Map<string, (stats: LocalDataStats) => void>()
  private relayStatusCallbacks = new Set<(statuses: any[]) => void>()
  private messageQueue: WorkerMessage[] = []
  private searchCallbacks = new Map<
    number,
    (results: Array<{item: SearchResult; score?: number}>) => void
  >()
  private searchReady = false

  // Heartbeat monitoring - detects unresponsive workers (infinite loops, deadlocks)
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private lastPong: number = Date.now()
  private readonly HEARTBEAT_INTERVAL_MS = 5000 // Send ping every 5s
  private readonly HEARTBEAT_TIMEOUT_MS = 15000 // 3 missed beats = unresponsive

  constructor(workerOrUrl: Worker | string | (() => Worker) = "/relay-worker.js") {
    if (typeof workerOrUrl === "string") {
      this.workerUrl = workerOrUrl
      this.worker = this.createWorker()
    } else if (typeof workerOrUrl === "function") {
      this.workerFactory = workerOrUrl
      this.worker = workerOrUrl()
      this.setupWorker(this.worker)
    } else {
      this.worker = workerOrUrl
      this.setupWorker(this.worker)
      console.warn(
        "[Worker Transport] Worker passed directly - restart on crash may fail"
      )
    }
  }

  private createWorker(): Worker {
    if (this.workerFactory) {
      const worker = this.workerFactory()
      this.setupWorker(worker)
      return worker
    }
    if (!this.workerUrl) {
      throw new Error("[Worker Transport] Cannot create worker: no URL or factory")
    }
    const worker = new Worker(this.workerUrl, {type: "module"})
    this.setupWorker(worker)
    return worker
  }

  private setupWorker(worker: Worker) {
    this.readyPromise = new Promise((resolve) => {
      const handler = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === "ready") {
          this.ready = true
          worker.removeEventListener("message", handler)
          this.restartAttempts = 0 // Reset on successful init
          this.flushMessageQueue()
          this.startHeartbeat()
          resolve()
        }
      }
      worker.addEventListener("message", handler)
    })

    // Handle worker crashes
    worker.onerror = (error) => {
      console.error("[Worker Transport] Worker error:", error)
      this.handleWorkerCrash()
    }

    // Setup message handlers after worker is assigned
    this.setupMessageHandler(worker)
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.lastPong = Date.now()

    this.heartbeatInterval = setInterval(() => {
      if (!this.ready) {
        return
      }

      // Check if worker is unresponsive
      if (Date.now() - this.lastPong > this.HEARTBEAT_TIMEOUT_MS) {
        console.error(
          "[Worker Transport] Worker unresponsive (no pong received), restarting..."
        )
        this.handleWorkerCrash()
        return
      }

      // Send ping
      this.worker.postMessage({type: "ping", id: Date.now().toString()} as WorkerMessage)
    }, this.HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  private async handleWorkerCrash() {
    this.stopHeartbeat()
    this.restartAttempts++
    this.ready = false

    // Check if we can restart
    if (!this.workerUrl && !this.workerFactory) {
      console.error(
        "[Worker Transport] Cannot restart worker - no URL or factory provided"
      )
      return
    }

    // Exponential backoff capped at 30s
    const delay = Math.min(1000 * Math.pow(2, this.restartAttempts - 1), 30_000)
    console.warn(
      `[Worker Transport] Worker crashed (attempt ${this.restartAttempts}), restarting in ${delay}ms...`
    )

    await new Promise((resolve) => setTimeout(resolve, delay))

    // Recreate worker
    this.worker.terminate()
    this.worker = this.createWorker()

    // Reinitialize with same config
    if (this.ndk && this.relayUrls.length > 0) {
      try {
        await this.connect(this.ndk, this.relayUrls)
        log(`Worker restarted successfully after ${this.restartAttempts} attempts`)
      } catch (error) {
        console.error("[Worker Transport] Failed to reconnect after restart:", error)
        // Will retry on next crash
      }
    }
  }

  async connect(ndk: NDK, relayUrls?: string[]): Promise<void> {
    this.ndk = ndk
    this.relayUrls = relayUrls || []

    // Register as transport plugin for publish and subscription interception
    if (!ndk.transportPlugins) {
      ndk.transportPlugins = []
    }
    ndk.transportPlugins.push(this as any) // Type compatibility handled at runtime

    const settingsState = useSettingsStore.getState()
    const settings = {
      appearance: settingsState.appearance,
      content: settingsState.content,
      imgproxy: settingsState.imgproxy,
      notifications: settingsState.notifications,
      network: settingsState.network,
      desktop: settingsState.desktop,
      debug: settingsState.debug,
      legal: settingsState.legal,
    }
    // Send init directly - don't queue (worker needs this to become ready)
    this.worker.postMessage({
      type: "init",
      relays: relayUrls || [],
      settings,
    } as WorkerMessage)

    // Forward browser online/offline events to worker
    if (typeof window !== "undefined") {
      window.addEventListener("offline", this.handleOffline)
      window.addEventListener("online", this.handleOnline)
    }

    // Subscribe to settings changes and forward to worker
    useSettingsStore.subscribe((state) => {
      const settings = {
        appearance: state.appearance,
        content: state.content,
        imgproxy: state.imgproxy,
        notifications: state.notifications,
        network: state.network,
        desktop: state.desktop,
        debug: state.debug,
        legal: state.legal,
      }
      this.postMessage({
        type: "updateSettings",
        settings,
      } as WorkerMessage)
    })

    // Don't await - let worker init in background
  }

  private postMessage(msg: WorkerMessage): void {
    if (this.ready) {
      this.worker.postMessage(msg)
    } else {
      this.messageQueue.push(msg)
    }
  }

  private flushMessageQueue(): void {
    log(`[Worker Transport] Flushing ${this.messageQueue.length} queued messages`)
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!
      this.worker.postMessage(msg)
    }
  }

  private handleOffline = () => {
    this.postMessage({type: "browserOffline"} as WorkerMessage)
  }

  private handleOnline = () => {
    this.postMessage({type: "browserOnline"} as WorkerMessage)
  }

  // Transport plugin hook - intercept publishes
  async onPublish(event: NDKEvent): Promise<void> {
    // Publish through worker instead of main thread pool
    await this.publish(event)
  }

  // Transport plugin hook - intercept subscriptions
  onSubscribe(
    subscription: any,
    filters: NDKFilter[],
    opts?: NDKSubscriptionOptions
  ): void {
    const subId = subscription.subId || subscription.internalId

    // Listen for subscription close to clean up worker subscription
    subscription.once("close", () => {
      this.unsubscribe(subId)
    })

    // Forward subscription to worker with cache usage options
    this.subscribe(
      subId,
      filters,
      (event: NDKEvent) => {
        // Emit event to main thread subscription
        // Pass event as NOT from cache (3rd param = false) so it gets processed
        subscription.eventReceived(event, undefined, false)
      },
      () => {
        // Emit EOSE to main thread subscription (pass null instead of undefined)
        // Worker doesn't have relay reference, subscription handles it
        subscription.eoseReceived(null as any)
      },
      opts
    )
  }

  async publish(event: NDKEvent, relays?: NDKRelay[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const id =
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15)
      this.publishResolvers.set(id, {resolve, reject})

      this.postMessage({
        type: "publish",
        id,
        event: event.rawEvent(),
        relays: relays?.map((r) => r.url),
      } as WorkerMessage)

      // Timeout after 10s
      setTimeout(() => {
        if (this.publishResolvers.has(id)) {
          this.publishResolvers.delete(id)
          reject(new Error("Publish timeout"))
        }
      }, 10_000)
    })
  }

  subscribe(
    subId: string,
    filters: NDKFilter[],
    onEvent: (event: NDKEvent) => void,
    onEose?: () => void,
    opts?: NDKSubscriptionOptions
  ): void {
    if (!this.subscriptions.has(subId)) {
      this.subscriptions.set(subId, new Set())
    }
    this.subscriptions.get(subId)!.add(onEvent)

    if (onEose) {
      if (!this.eoseHandlers.has(subId)) {
        this.eoseHandlers.set(subId, new Set())
      }
      this.eoseHandlers.get(subId)!.add(onEose)
    }

    // Convert cacheUsage enum to destinations array for worker
    const subscribeOpts: WorkerSubscribeOpts = {}
    if (opts?.cacheUsage) {
      switch (opts.cacheUsage) {
        case NDKSubscriptionCacheUsage.ONLY_CACHE:
          subscribeOpts.destinations = ["cache"]
          subscribeOpts.closeOnEose = true
          break
        case NDKSubscriptionCacheUsage.ONLY_RELAY:
          subscribeOpts.destinations = ["relay"]
          break
        case NDKSubscriptionCacheUsage.PARALLEL:
          subscribeOpts.destinations = ["cache", "relay"]
          // Let worker default handle groupable - don't disable it
          break
        case NDKSubscriptionCacheUsage.CACHE_FIRST:
        default:
          subscribeOpts.destinations = ["cache", "relay"]
          // Don't set groupable here - let explicit opts override or worker default
          break
      }
    }

    // Pass through groupable options if explicitly set
    if (opts?.groupable !== undefined) {
      subscribeOpts.groupable = opts.groupable
    }
    if (opts?.groupableDelay !== undefined) {
      subscribeOpts.groupableDelay = opts.groupableDelay
    }
    if (opts?.closeOnEose !== undefined) {
      subscribeOpts.closeOnEose = opts.closeOnEose
    }

    this.postMessage({
      type: "subscribe",
      id: subId,
      filters,
      subscribeOpts,
    } as WorkerMessage)
  }

  unsubscribe(subId: string): void {
    this.subscriptions.delete(subId)
    this.eoseHandlers.delete(subId)

    this.postMessage({
      type: "unsubscribe",
      id: subId,
    } as WorkerMessage)
  }

  close(): void {
    this.stopHeartbeat()

    // Remove event listeners
    if (typeof window !== "undefined") {
      window.removeEventListener("offline", this.handleOffline)
      window.removeEventListener("online", this.handleOnline)
    }

    this.postMessage({type: "close"} as WorkerMessage)
    this.worker.terminate()
  }

  /**
   * Get current status of all relays in worker
   */
  async getRelayStatus(): Promise<
    Array<{
      url: string
      status: number
      stats?: {attempts: number; success: number; connectedAt?: number}
    }>
  > {
    return new Promise((resolve) => {
      const id =
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15)
      const handler = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === "relayStatus" && e.data.id === id) {
          this.worker.removeEventListener("message", handler)
          resolve(e.data.relayStatuses || [])
        }
      }
      this.worker.addEventListener("message", handler)
      this.postMessage({type: "getRelayStatus", id} as WorkerMessage)
      setTimeout(() => resolve([]), 1000) // Timeout fallback
    })
  }

  /**
   * Add relay to worker pool
   */
  async addRelay(url: string): Promise<void> {
    this.postMessage({type: "addRelay", url} as WorkerMessage)
  }

  /**
   * Remove relay from worker pool
   */
  async removeRelay(url: string): Promise<void> {
    this.postMessage({type: "removeRelay", url} as WorkerMessage)
  }

  /**
   * Connect specific relay
   */
  async connectRelay(url: string): Promise<void> {
    this.postMessage({type: "connectRelay", url} as WorkerMessage)
  }

  /**
   * Disconnect specific relay
   */
  async disconnectRelay(url: string): Promise<void> {
    this.postMessage({type: "disconnectRelay", url} as WorkerMessage)
  }

  /**
   * Reconnect disconnected relays
   */
  reconnectDisconnected(reason: string): void {
    this.postMessage({type: "reconnectDisconnected", reason} as WorkerMessage)
  }

  /**
   * Inject event from WebRTC - verify, dispatch to subscriptions & cache, no relay publish
   */
  injectEvent(eventData: any, source: string): void {
    this.postMessage({
      type: "publish",
      event: eventData,
      publishOpts: {
        publishTo: ["subscriptions", "cache"],
        verifySignature: true,
        source,
      },
    } as WorkerMessage)
  }

  /**
   * Cache-only subscription (e.g., for WebRTC REQ)
   */
  subscribeCacheOnly(
    subId: string,
    filters: NDKFilter[],
    onEvent: (event: NDKEvent) => void,
    onEose?: () => void
  ): void {
    // Register handlers same as regular subscribe
    if (!this.subscriptions.has(subId)) {
      this.subscriptions.set(subId, new Set())
    }
    this.subscriptions.get(subId)!.add(onEvent)

    if (onEose) {
      if (!this.eoseHandlers.has(subId)) {
        this.eoseHandlers.set(subId, new Set())
      }
      this.eoseHandlers.get(subId)!.add(onEose)
    }

    this.postMessage({
      type: "subscribe",
      id: subId,
      filters,
      subscribeOpts: {
        destinations: ["cache"],
        closeOnEose: true,
      },
    } as WorkerMessage)
  }

  private setupMessageHandler(worker: Worker): void {
    worker.onmessage = async (e: MessageEvent<WorkerResponse>) => {
      const {type, subId, event, relay, notice, error, id} = e.data

      switch (type) {
        case "pong":
          this.lastPong = Date.now()
          break

        case "event":
          if (subId && event && this.ndk) {
            const {NDKEvent} = await import("./ndk/events")
            const ndkEvent = new NDKEvent(this.ndk, event)
            const handlers = this.subscriptions.get(subId)
            if (handlers) {
              handlers.forEach((handler) => handler(ndkEvent))
            }
          }
          break

        case "eose":
          if (subId) {
            const handlers = this.eoseHandlers.get(subId)
            if (handlers) {
              handlers.forEach((handler) => handler())
            }
          }
          break

        case "notice":
          if (relay && notice) {
            console.warn(`[Relay ${relay}] ${notice}`)
          }
          break

        case "published":
          if (id) {
            const resolver = this.publishResolvers.get(id)
            if (resolver) {
              resolver.resolve()
              this.publishResolvers.delete(id)
            }
          }
          break

        case "error":
          if (id && error) {
            const resolver = this.publishResolvers.get(id)
            if (resolver) {
              resolver.reject(new Error(error))
              this.publishResolvers.delete(id)
            }
          }
          console.error("[Worker Transport]", error)
          break

        case "stats":
          if (id) {
            const callback = this.statsCallbacks.get(id)
            if (callback) {
              callback(e.data.stats!)
              this.statsCallbacks.delete(id)
            }
          }
          break

        case "relayStatusUpdate":
          if (e.data.relayStatuses) {
            this.relayStatusCallbacks.forEach((cb) => cb(e.data.relayStatuses!))
          }
          break

        case "searchReady":
          this.searchReady = true
          break

        case "searchResult":
          if (e.data.searchRequestId !== undefined) {
            const callback = this.searchCallbacks.get(e.data.searchRequestId)
            if (callback) {
              callback(e.data.searchResults || [])
              this.searchCallbacks.delete(e.data.searchRequestId)
            }
          }
          break
      }
    }
  }

  onRelayStatusUpdate(callback: (statuses: any[]) => void): () => void {
    this.relayStatusCallbacks.add(callback)
    return () => this.relayStatusCallbacks.delete(callback)
  }

  async getStats(): Promise<LocalDataStats> {
    const id = Math.random().toString(36).substring(7)

    return new Promise((resolve) => {
      this.statsCallbacks.set(id, resolve)

      this.postMessage({
        type: "getStats",
        id,
      } as WorkerMessage)

      setTimeout(() => {
        if (this.statsCallbacks.has(id)) {
          this.statsCallbacks.delete(id)
          resolve({totalEvents: 0, eventsByKind: {}})
        }
      }, 1000)
    })
  }

  private searchRequestId = 0

  search(query: string): Promise<Array<{item: SearchResult; score?: number}>> {
    return new Promise((resolve) => {
      const id = ++this.searchRequestId
      this.searchCallbacks.set(id, resolve)
      this.postMessage({
        type: "search",
        searchQuery: query,
        searchRequestId: id,
      } as WorkerMessage)
      setTimeout(() => {
        if (this.searchCallbacks.has(id)) {
          this.searchCallbacks.delete(id)
          resolve([])
        }
      }, 1000)
    })
  }

  isSearchReady(): boolean {
    return this.searchReady
  }
}

export type {LocalDataStats, SearchResult}
