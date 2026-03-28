import {DebugSession} from "@/debug/DebugSession"
import {useSettingsStore} from "@/stores/settings"
import {ndk} from "./ndk"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {getShareableAppOrigin} from "@/utils/utils"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

class DebugManager {
  private static instance: DebugManager
  private debugSession: DebugSession | null = null
  private heartbeatInterval: NodeJS.Timeout | null = null

  private constructor() {
    this.init()
  }

  static getInstance(): DebugManager {
    if (!DebugManager.instance) {
      DebugManager.instance = new DebugManager()
    }
    return DebugManager.instance
  }

  private init() {
    // Check if debug mode is enabled
    if (this.isDebugEnabled()) {
      this.initializeDebugSession()
    }
  }

  private initializeDebugSession() {
    if (this.debugSession) {
      return // Already initialized
    }

    // Get existing debug private key from settings store
    const settings = useSettingsStore.getState()
    const debugPrivateKey = settings.debug.privateKey || undefined

    this.debugSession = new DebugSession(debugPrivateKey)

    // Start heartbeat
    this.startHeartbeat()

    log(
      "Debug session initialized",
      debugPrivateKey ? "with persistence" : "without persistence"
    )
  }

  private cleanupDebugSession() {
    if (this.debugSession) {
      this.stopHeartbeat()
      this.debugSession.close()
      this.debugSession = null
      log("Debug session cleaned up")
    }
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) {
      return // Already started
    }

    const sendHeartbeat = () => {
      if (this.debugSession) {
        // Get memory usage
        let memoryUsage = null
        if (
          typeof performance !== "undefined" &&
          "memory" in performance &&
          performance.memory
        ) {
          memoryUsage = {
            used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
            total: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024),
          }
        }

        // Get NDK subscription manager info
        const ndkInstance = ndk()
        const subManager = ndkInstance.subManager

        // Prepare compact subscription data for debug session
        const subscriptionsData: Record<string, {filters: unknown[]; relays: string[]}> =
          {}
        subManager.subscriptions.forEach((subscription, id) => {
          // Process filters to make them more compact
          const compactFilters = subscription.filters.map((filter: unknown) => {
            const compactFilter = {...(filter as Record<string, unknown>)}
            // Replace large authors arrays with count
            if (
              compactFilter.authors &&
              Array.isArray(compactFilter.authors) &&
              compactFilter.authors.length > 10
            ) {
              compactFilter.authors = `[${compactFilter.authors.length} authors]`
            }
            return compactFilter
          })

          subscriptionsData[id] = {
            filters: compactFilters,
            relays: Array.from(subscription.relayFilters?.keys() || []),
          }
        })

        const ndkInfo = {
          subscriptionsCount: subManager.subscriptions.size,
          seenEventsCount: subManager.seenEvents.size,
          subscriptionIds: Array.from(subManager.subscriptions.keys()),
          relayCount: ndkInstance.pool.relays.size,
          connectedRelays: Array.from(ndkInstance.pool.relays.entries())
            .filter(([, relay]) => relay.connected)
            .map(([url]) => url),
        }

        const heartbeatData = {
          status: "online",
          userAgent: navigator.userAgent,
          url: window.location.href,
          systemInfo: {
            appVersion: import.meta.env.VITE_APP_VERSION || "dev",
            buildTime: import.meta.env.VITE_BUILD_TIME || "development",
            memoryUsage,
          },
          ndkInfo,
        }
        this.debugSession.publish("data", heartbeatData)

        // Send subscription data separately to avoid size limits
        log(
          "📊 Sending subscription data:",
          Object.keys(subscriptionsData).length,
          "subscriptions"
        )
        this.debugSession.publish("subscriptions", subscriptionsData)
      }
    }

    // Send heartbeat every 5 seconds
    this.heartbeatInterval = setInterval(sendHeartbeat, 5000)

    // Send initial heartbeat immediately
    sendHeartbeat()
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  // Public API
  isDebugEnabled(): boolean {
    const settings = useSettingsStore.getState()
    return settings.debug.enabled
  }

  enableDebug(): void {
    const settings = useSettingsStore.getState()
    settings.updateDebug({enabled: true})
    this.initializeDebugSession()
  }

  disableDebug(): void {
    const settings = useSettingsStore.getState()
    settings.updateDebug({enabled: false, privateKey: null})
    this.cleanupDebugSession()
  }

  savePrivateKey(privateKey: string): void {
    const settings = useSettingsStore.getState()
    settings.updateDebug({privateKey})
  }

  clearPrivateKey(): void {
    const settings = useSettingsStore.getState()
    settings.updateDebug({privateKey: null})
  }

  getDebugSession(): DebugSession | null {
    return this.debugSession
  }

  getDebugSessionLink(): string {
    if (!this.debugSession) {
      return ""
    }
    const origin = getShareableAppOrigin()
    return `${origin}/debug.html#${this.debugSession.getPrivateKey()}`
  }
}

// Export singleton instance
export default DebugManager.getInstance()
