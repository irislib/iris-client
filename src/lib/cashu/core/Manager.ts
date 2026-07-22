import type {Repositories, MintQuoteRepository} from "./repositories"
import {
  CounterService,
  MintService,
  MintQuoteService,
  MintQuoteWatcherService,
  MintQuoteProcessor,
  ProofService,
  WalletService,
  SeedService,
  WalletRestoreService,
  ProofStateWatcherService,
  MeltQuoteService,
  HistoryService,
} from "./services"
import {SubscriptionManager, type WebSocketFactory, PollingTransport} from "./infra"
import {EventBus, type CoreEvents} from "./events"
import {type Logger, NullLogger} from "./logging"
import {MintApi, WalletApi, QuotesApi, HistoryApi} from "./api"
import {SubscriptionApi} from "./api/SubscriptionApi.ts"
import {PluginHost} from "./plugins/PluginHost.ts"
import type {Plugin, ServiceMap} from "./plugins/types.ts"

/**
 * Configuration options for initializing the Coco Cashu manager
 */
export interface CocoConfig {
  /** Repository implementations for data persistence */
  repo: Repositories
  /** Function that returns the wallet seed as Uint8Array */
  seedGetter: () => Promise<Uint8Array>
  /** Optional logger instance (defaults to NullLogger) */
  logger?: Logger
  /** Optional WebSocket factory for real-time subscriptions */
  webSocketFactory?: WebSocketFactory
  /** Optional plugins to extend functionality */
  plugins?: Plugin[]
  /**
   * Watcher configuration (all enabled by default)
   * - Omit to use defaults (enabled)
   * - Set `disabled: true` to disable
   * - Provide options to customize behavior
   */
  watchers?: {
    /** Mint quote watcher (enabled by default) */
    mintQuoteWatcher?: {
      disabled?: boolean
      watchExistingPendingOnStart?: boolean
    }
    /** Proof state watcher (enabled by default) */
    proofStateWatcher?: {
      disabled?: boolean
    }
  }
  /**
   * Processor configuration (all enabled by default)
   * - Omit to use defaults (enabled)
   * - Set `disabled: true` to disable
   * - Provide options to customize behavior
   */
  processors?: {
    /** Mint quote processor (enabled by default) */
    mintQuoteProcessor?: {
      disabled?: boolean
      processIntervalMs?: number
      maxRetries?: number
      baseRetryDelayMs?: number
      initialEnqueueDelayMs?: number
    }
  }
}

/**
 * Initializes and configures a new Coco Cashu manager instance
 * @param config - Configuration options including repositories, seed, and optional features
 * @returns A fully initialized Manager instance
 */
export async function initializeCoco(config: CocoConfig): Promise<Manager> {
  await config.repo.init()
  const coco = new Manager(
    config.repo,
    config.seedGetter,
    config.logger,
    config.webSocketFactory,
    config.plugins,
    config.watchers,
    config.processors
  )

  // Recovery is best-effort and intentionally does not delay wallet startup.
  // The timeout bounds this startup task; per-quote locks also make a later
  // manual refresh safe if an underlying request is still settling.
  let recoveryTimeout: ReturnType<typeof setTimeout> | undefined
  const startupRecovery = new Promise<void>((resolve, reject) => {
    recoveryTimeout = setTimeout(
      () => reject(new Error("Pending melt recovery timed out")),
      15_000
    )
    void coco.quotes.reconcilePendingMelts().then(() => resolve(), reject)
  })
  void startupRecovery
    .catch((err) => config.logger?.warn("Startup melt recovery incomplete", {err}))
    .finally(() => clearTimeout(recoveryTimeout))

  // Enable watchers (default: all enabled unless explicitly disabled)
  const mintQuoteWatcherConfig = config.watchers?.mintQuoteWatcher
  if (!mintQuoteWatcherConfig?.disabled) {
    await coco.enableMintQuoteWatcher(mintQuoteWatcherConfig)
  }

  const proofStateWatcherConfig = config.watchers?.proofStateWatcher
  if (!proofStateWatcherConfig?.disabled) {
    await coco.enableProofStateWatcher()
  }

  // Enable processors (default: all enabled unless explicitly disabled)
  const mintQuoteProcessorConfig = config.processors?.mintQuoteProcessor
  if (!mintQuoteProcessorConfig?.disabled) {
    await coco.enableMintQuoteProcessor(mintQuoteProcessorConfig)
    await coco.quotes.requeuePaidMintQuotes()
  }

  return coco
}

export class Manager {
  readonly mint: MintApi
  readonly wallet: WalletApi
  readonly quotes: QuotesApi
  readonly subscription: SubscriptionApi
  readonly history: HistoryApi
  private mintService: MintService
  private walletService: WalletService
  private proofService: ProofService
  private walletRestoreService: WalletRestoreService
  private eventBus: EventBus<CoreEvents>
  private logger: Logger
  readonly subscriptions: SubscriptionManager
  private mintQuoteService: MintQuoteService
  private mintQuoteWatcher?: MintQuoteWatcherService
  private mintQuoteProcessor?: MintQuoteProcessor
  private mintQuoteRepository: MintQuoteRepository
  private proofStateWatcher?: ProofStateWatcherService
  private meltQuoteService: MeltQuoteService
  private historyService: HistoryService
  private seedService: SeedService
  private counterService: CounterService
  private readonly pluginHost: PluginHost = new PluginHost()
  private subscriptionsPaused = false
  private originalWatcherConfig: CocoConfig["watchers"]
  private originalProcessorConfig: CocoConfig["processors"]
  constructor(
    repositories: Repositories,
    seedGetter: () => Promise<Uint8Array>,
    logger?: Logger,
    webSocketFactory?: WebSocketFactory,
    plugins?: Plugin[],
    watchers?: CocoConfig["watchers"],
    processors?: CocoConfig["processors"]
  ) {
    this.logger = logger ?? new NullLogger()
    this.eventBus = this.createEventBus()
    this.subscriptions = this.createSubscriptionManager(webSocketFactory)
    this.originalWatcherConfig = watchers
    this.originalProcessorConfig = processors
    if (plugins && plugins.length > 0) {
      for (const p of plugins) this.pluginHost.use(p)
    }
    const core = this.buildCoreServices(repositories, seedGetter)
    this.mintService = core.mintService
    this.walletService = core.walletService
    this.proofService = core.proofService
    this.walletRestoreService = core.walletRestoreService
    this.seedService = core.seedService
    this.counterService = core.counterService
    this.mintQuoteService = core.mintQuoteService
    this.mintQuoteRepository = core.mintQuoteRepository
    this.meltQuoteService = core.meltQuoteService
    this.historyService = core.historyService
    const apis = this.buildApis()
    this.mint = apis.mint
    this.wallet = apis.wallet
    this.quotes = apis.quotes
    this.subscription = apis.subscription
    this.history = apis.history

    // Initialize plugins asynchronously to keep constructor sync
    const services: ServiceMap = {
      mintService: this.mintService,
      walletService: this.walletService,
      proofService: this.proofService,
      seedService: this.seedService,
      walletRestoreService: this.walletRestoreService,
      counterService: this.counterService,
      mintQuoteService: this.mintQuoteService,
      meltQuoteService: this.meltQuoteService,
      historyService: this.historyService,
      subscriptions: this.subscriptions,
      eventBus: this.eventBus,
      logger: this.logger,
    }
    void this.pluginHost
      .init(services)
      .then(() => this.pluginHost.ready())
      .catch((err) => {
        this.logger.error("Plugin system initialization failed", err)
      })
  }

  on<E extends keyof CoreEvents>(
    event: E,
    handler: (payload: CoreEvents[E]) => void | Promise<void>
  ): () => void {
    return this.eventBus.on(event, handler)
  }

  once<E extends keyof CoreEvents>(
    event: E,
    handler: (payload: CoreEvents[E]) => void | Promise<void>
  ): () => void {
    return this.eventBus.once(event, handler)
  }

  use(plugin: Plugin): void {
    this.pluginHost.use(plugin)
  }

  async dispose(): Promise<void> {
    await this.pluginHost.dispose()
  }

  off<E extends keyof CoreEvents>(
    event: E,
    handler: (payload: CoreEvents[E]) => void | Promise<void>
  ): void {
    return this.eventBus.off(event, handler)
  }

  async enableMintQuoteWatcher(options?: {
    watchExistingPendingOnStart?: boolean
  }): Promise<void> {
    if (this.mintQuoteWatcher?.isRunning()) return
    const watcherLogger = this.logger.child
      ? this.logger.child({module: "MintQuoteWatcherService"})
      : this.logger
    this.mintQuoteWatcher = new MintQuoteWatcherService(
      this.mintQuoteRepository,
      this.subscriptions,
      this.mintQuoteService,
      this.eventBus,
      watcherLogger,
      {watchExistingPendingOnStart: options?.watchExistingPendingOnStart ?? true}
    )
    await this.mintQuoteWatcher.start()
  }

  async disableMintQuoteWatcher(): Promise<void> {
    if (!this.mintQuoteWatcher) return
    await this.mintQuoteWatcher.stop()
    this.mintQuoteWatcher = undefined
  }

  async enableMintQuoteProcessor(options?: {
    processIntervalMs?: number
    maxRetries?: number
    baseRetryDelayMs?: number
    initialEnqueueDelayMs?: number
  }): Promise<boolean> {
    if (this.mintQuoteProcessor?.isRunning()) return false
    const processorLogger = this.logger.child
      ? this.logger.child({module: "MintQuoteProcessor"})
      : this.logger
    this.mintQuoteProcessor = new MintQuoteProcessor(
      this.mintQuoteService,
      this.eventBus,
      processorLogger,
      options
    )
    await this.mintQuoteProcessor.start()
    return true
  }

  async disableMintQuoteProcessor(): Promise<void> {
    if (!this.mintQuoteProcessor) return
    await this.mintQuoteProcessor.stop()
    this.mintQuoteProcessor = undefined
  }

  async waitForMintQuoteProcessor(): Promise<void> {
    if (!this.mintQuoteProcessor) return
    await this.mintQuoteProcessor.waitForCompletion()
  }

  async enableProofStateWatcher(): Promise<void> {
    if (this.proofStateWatcher?.isRunning()) return
    const watcherLogger = this.logger.child
      ? this.logger.child({module: "ProofStateWatcherService"})
      : this.logger
    this.proofStateWatcher = new ProofStateWatcherService(
      this.subscriptions,
      this.proofService,
      this.eventBus,
      watcherLogger
    )
    await this.proofStateWatcher.start()
  }

  async disableProofStateWatcher(): Promise<void> {
    if (!this.proofStateWatcher) return
    await this.proofStateWatcher.stop()
    this.proofStateWatcher = undefined
  }

  async pauseSubscriptions(): Promise<void> {
    if (this.subscriptionsPaused) {
      this.logger.debug("Subscriptions already paused")
      return
    }
    this.subscriptionsPaused = true
    this.logger.info("Pausing subscriptions")

    // Pause transport layer
    this.subscriptions.pause()

    // Disable watchers
    await this.disableMintQuoteWatcher()
    await this.disableProofStateWatcher()

    // Disable processor
    await this.disableMintQuoteProcessor()

    this.logger.info("Subscriptions paused")
  }

  async resumeSubscriptions(): Promise<void> {
    this.subscriptionsPaused = false
    this.logger.info("Resuming subscriptions")

    // Resume transport layer
    this.subscriptions.resume()

    // Re-enable watchers based on original configuration (idempotent)
    const mintQuoteWatcherConfig = this.originalWatcherConfig?.mintQuoteWatcher
    if (!mintQuoteWatcherConfig?.disabled) {
      await this.enableMintQuoteWatcher(mintQuoteWatcherConfig)
    }

    const proofStateWatcherConfig = this.originalWatcherConfig?.proofStateWatcher
    if (!proofStateWatcherConfig?.disabled) {
      await this.enableProofStateWatcher()
    }

    // Re-enable processor based on original configuration (idempotent)
    const mintQuoteProcessorConfig = this.originalProcessorConfig?.mintQuoteProcessor
    if (!mintQuoteProcessorConfig?.disabled) {
      const wasEnabled = await this.enableMintQuoteProcessor(mintQuoteProcessorConfig)
      // Only requeue if we actually re-enabled (not already running)
      if (wasEnabled) {
        await this.quotes.requeuePaidMintQuotes()
      }
    }

    this.logger.info("Subscriptions resumed")
  }

  private getChildLogger(moduleName: string): Logger {
    return this.logger.child ? this.logger.child({module: moduleName}) : this.logger
  }

  private createEventBus(): EventBus<CoreEvents> {
    const eventLogger = this.getChildLogger("EventBus")
    return new EventBus<CoreEvents>({
      onError: (args) => {
        eventLogger.error("Event handler error", args)
      },
    })
  }

  private createSubscriptionManager(
    webSocketFactory?: WebSocketFactory
  ): SubscriptionManager {
    const wsLogger = this.getChildLogger("SubscriptionManager")
    // Detect global WebSocket if available, otherwise require injected factory
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasGlobalWs = typeof (globalThis as any).WebSocket !== "undefined"
    const defaultFactory: WebSocketFactory | undefined = hasGlobalWs
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (url: string) => new (globalThis as any).WebSocket(url)
      : undefined
    const wsFactoryToUse = webSocketFactory ?? defaultFactory
    const capabilitiesProvider = {
      getMintInfo: async (mintUrl: string) => {
        if (!this.mintService) throw new Error("MintService not initialized yet")
        return this.mintService.getMintInfo(mintUrl)
      },
    }
    if (!wsFactoryToUse) {
      // Fallback to polling transport when WS is unavailable
      const polling = new PollingTransport({intervalMs: 5000}, wsLogger)
      return new SubscriptionManager(polling, wsLogger, capabilitiesProvider)
    }
    return new SubscriptionManager(wsFactoryToUse, wsLogger, capabilitiesProvider)
  }

  private buildCoreServices(
    repositories: Repositories,
    seedGetter: () => Promise<Uint8Array>
  ): {
    mintService: MintService
    seedService: SeedService
    walletService: WalletService
    counterService: CounterService
    proofService: ProofService
    walletRestoreService: WalletRestoreService
    mintQuoteService: MintQuoteService
    mintQuoteRepository: MintQuoteRepository
    meltQuoteService: MeltQuoteService
    historyService: HistoryService
  } {
    const mintLogger = this.getChildLogger("MintService")
    const walletLogger = this.getChildLogger("WalletService")
    const counterLogger = this.getChildLogger("CounterService")
    const proofLogger = this.getChildLogger("ProofService")
    const mintQuoteLogger = this.getChildLogger("MintQuoteService")
    const walletRestoreLogger = this.getChildLogger("WalletRestoreService")
    const meltQuoteLogger = this.getChildLogger("MeltQuoteService")
    const historyLogger = this.getChildLogger("HistoryService")
    const mintService = new MintService(
      repositories.mintRepository,
      repositories.keysetRepository,
      mintLogger,
      this.eventBus
    )
    const seedService = new SeedService(seedGetter)
    const walletService = new WalletService(mintService, seedService, walletLogger)
    const counterService = new CounterService(
      repositories.counterRepository,
      counterLogger,
      this.eventBus
    )
    const proofService = new ProofService(
      counterService,
      repositories.proofRepository,
      walletService,
      seedService,
      proofLogger,
      this.eventBus
    )
    const walletRestoreService = new WalletRestoreService(
      proofService,
      counterService,
      walletRestoreLogger
    )

    const quotesService = new MintQuoteService(
      repositories.mintQuoteRepository,
      walletService,
      proofService,
      this.eventBus,
      mintQuoteLogger
    )
    const mintQuoteService = quotesService
    const mintQuoteRepository = repositories.mintQuoteRepository

    const meltQuoteService = new MeltQuoteService(
      proofService,
      walletService,
      repositories.meltQuoteRepository,
      this.eventBus,
      meltQuoteLogger
    )

    const historyService = new HistoryService(
      repositories.historyRepository,
      this.eventBus,
      historyLogger
    )

    return {
      mintService,
      seedService,
      walletService,
      counterService,
      proofService,
      walletRestoreService,
      mintQuoteService,
      mintQuoteRepository,
      meltQuoteService,
      historyService,
    }
  }

  private buildApis(): {
    mint: MintApi
    wallet: WalletApi
    quotes: QuotesApi
    subscription: SubscriptionApi
    history: HistoryApi
  } {
    const walletApiLogger = this.getChildLogger("WalletApi")
    const subscriptionApiLogger = this.getChildLogger("SubscriptionApi")
    const mint = new MintApi(this.mintService)
    const wallet = new WalletApi(
      this.mintService,
      this.walletService,
      this.proofService,
      this.walletRestoreService,
      this.eventBus,
      walletApiLogger
    )
    const quotes = new QuotesApi(this.mintQuoteService, this.meltQuoteService)
    const subscription = new SubscriptionApi(this.subscriptions, subscriptionApiLogger)
    const history = new HistoryApi(this.historyService)
    return {mint, wallet, quotes, subscription, history}
  }
}
