import {DebugSession} from "@/debug/DebugSession"
import {useSettingsStore} from "@/stores/settings"
import {DEFAULT_RELAYS} from "./applesauce"

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

    console.log(
      "Debug session initialized",
      debugPrivateKey ? "with persistence" : "without persistence"
    )
  }

  private cleanupDebugSession() {
    if (this.debugSession) {
      this.stopHeartbeat()
      this.debugSession.close()
      this.debugSession = null
      console.log("Debug session cleaned up")
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
          const memory = performance.memory as {
            usedJSHeapSize: number
            jsHeapSizeLimit: number
          }
          memoryUsage = {
            used: Math.round(memory.usedJSHeapSize / 1024 / 1024),
            total: Math.round(memory.jsHeapSizeLimit / 1024 / 1024),
          }
        }

        // Get pool info
        const poolInfo = {
          relayCount: DEFAULT_RELAYS.length,
          connectedRelays: DEFAULT_RELAYS,
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
          poolInfo,
        }
        this.debugSession.publish("data", heartbeatData)

        // Note: Subscription tracking not implemented for Applesauce yet
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
    return `${window.location.origin}/debug.html#${this.debugSession.getPrivateKey()}`
  }
}

// Export singleton instance
export default DebugManager.getInstance()
