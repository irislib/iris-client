import {useState, useEffect, ChangeEvent} from "react"
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import CopyButton from "@/shared/components/button/CopyButton"
import {LogViewer} from "@/shared/components/settings/LogViewer"
import Debug from "@/utils/DebugManager"
import {useSettingsStore} from "@/stores/settings"
import {isTauri, isMobileTauri} from "@/utils/utils"
import {
  enable as enableAutostart,
  disable as disableAutostart,
} from "@tauri-apps/plugin-autostart"

export default function SystemSettings() {
  const [memoryUsage, setMemoryUsage] = useState<{
    used: number
    total: number
  } | null>(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [debugMode, setDebugMode] = useState(false)
  const [debugSessionLink, setDebugSessionLink] = useState<string>("")
  const [testValue, setTestValue] = useState<string>("")
  const [preserveDebugSession, setPreserveDebugSession] = useState(false)
  const [isDesktopTauri, setIsDesktopTauri] = useState(false)
  const {debug, desktop, updateDesktop} = useSettingsStore()

  const appVersion = import.meta.env.VITE_APP_VERSION || "dev"
  const buildTime = import.meta.env.VITE_BUILD_TIME || "development"

  const formatBuildTime = (timestamp: string) => {
    if (timestamp === "development") return timestamp
    try {
      const date = new Date(timestamp)
      return new Intl.DateTimeFormat("default", {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(date)
    } catch {
      return timestamp
    }
  }

  useEffect(() => {
    // Check if running on desktop Tauri (not mobile)
    if (isTauri()) {
      isMobileTauri().then((isMobile) => {
        setIsDesktopTauri(!isMobile)
      })
    }
  }, [])

  useEffect(() => {
    const updateMemoryUsage = () => {
      if (
        typeof performance !== "undefined" &&
        "memory" in performance &&
        performance.memory
      ) {
        setMemoryUsage({
          used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
          total: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024),
        })
      }
    }

    updateMemoryUsage()
    const interval = setInterval(updateMemoryUsage, 2000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    // Check for service worker updates
    if ("serviceWorker" in navigator) {
      const handleControllerChange = () => setUpdateAvailable(true)
      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange)
      return () => {
        navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange)
      }
    }
  }, [])

  useEffect(() => {
    // Initialize debug mode state from settings store
    setDebugMode(debug.enabled)
    setDebugSessionLink(Debug.getDebugSessionLink())
    setPreserveDebugSession(!!debug.privateKey)

    // Subscribe to test value changes if debug is enabled
    let unsubscribe: (() => void) | null = null

    if (debug.enabled) {
      const debugSession = Debug.getDebugSession()
      if (debugSession) {
        unsubscribe = debugSession.subscribe("testInput", (value) => {
          if (typeof value === "string") {
            setTestValue(value)
          }
        })
      }
    }

    return () => {
      unsubscribe?.()
    }
  }, [debug.enabled, debug.privateKey])

  const toggleDebugMode = () => {
    const newDebugMode = !debugMode
    setDebugMode(newDebugMode)

    if (newDebugMode) {
      Debug.enableDebug()
    } else {
      Debug.disableDebug()
    }

    // Update link and reset test value
    setDebugSessionLink(Debug.getDebugSessionLink())
    if (!newDebugMode) {
      setTestValue("")
    }
  }

  const togglePreserveDebugSession = () => {
    const newPreserve = !preserveDebugSession
    setPreserveDebugSession(newPreserve)

    if (newPreserve) {
      // Save current session's private key for persistence
      const debugSession = Debug.getDebugSession()
      if (debugSession) {
        Debug.savePrivateKey(debugSession.getPrivateKey())
      }
    } else {
      // Clear the saved private key when disabling preserve
      Debug.clearPrivateKey()
    }
  }

  const handleTestInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setTestValue(newValue)
    const debugSession = Debug.getDebugSession()
    debugSession?.publish("testInput", newValue)
  }

  const refreshApp = () => {
    window.location.reload()
  }

  const toggleStartOnBoot = async () => {
    const newValue = !desktop.startOnBoot
    updateDesktop({startOnBoot: newValue})

    try {
      if (newValue) {
        await enableAutostart()
      } else {
        await disableAutostart()
      }
    } catch (error) {
      console.error("Failed to update autostart setting:", error)
      // Revert on error
      updateDesktop({startOnBoot: !newValue})
    }
  }

  return (
    <div className="bg-base-200 min-h-full">
      <div className="p-4">
        <div className="space-y-6">
          {isDesktopTauri && (
            <SettingsGroup title="Desktop">
              <SettingsGroupItem isLast>
                <div className="flex justify-between items-center">
                  <div className="flex flex-col">
                    <span>Start on System Boot</span>
                    <span className="text-sm text-base-content/60">
                      Launch Iris automatically when your computer starts (minimized)
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    className="toggle toggle-primary"
                    checked={desktop.startOnBoot}
                    onChange={toggleStartOnBoot}
                  />
                </div>
              </SettingsGroupItem>
            </SettingsGroup>
          )}

          <SettingsGroup title="Maintenance">
            <SettingsGroupItem isLast>
              <div className="flex flex-col space-y-2">
                <button
                  onClick={refreshApp}
                  className={`text-info text-left ${updateAvailable ? "animate-pulse" : ""}`}
                >
                  {updateAvailable
                    ? "Update Available - Click to Refresh"
                    : "Refresh Application"}
                </button>
                <p className="text-xs text-base-content/60">
                  Reload the application to apply any pending updates or fix issues.
                </p>
              </div>
            </SettingsGroupItem>
          </SettingsGroup>

          <SettingsGroup title="Application Info">
            <SettingsGroupItem>
              <div className="flex justify-between items-center">
                <span>Version</span>
                <span className="text-base-content/70">
                  {isTauri() ? (
                    <>
                      <span className="line-through opacity-50">Web</span> /{" "}
                      <strong>Native</strong>
                    </>
                  ) : (
                    <>
                      <strong>Web</strong> /{" "}
                      <span className="line-through opacity-50">Native</span>
                    </>
                  )}
                </span>
              </div>
            </SettingsGroupItem>

            <SettingsGroupItem>
              <div className="flex justify-between items-center">
                <span>App Version</span>
                <span className="text-base-content/70">{appVersion}</span>
              </div>
            </SettingsGroupItem>

            <SettingsGroupItem>
              <div className="flex justify-between items-center">
                <span>Build Time</span>
                <span className="text-base-content/70 text-sm">
                  {formatBuildTime(buildTime)}
                </span>
              </div>
            </SettingsGroupItem>

            {memoryUsage && (
              <SettingsGroupItem isLast>
                <div className="flex justify-between items-center">
                  <span>Memory Usage</span>
                  <span className="text-base-content/70">
                    {memoryUsage.used}MB / {memoryUsage.total}MB
                  </span>
                </div>
              </SettingsGroupItem>
            )}
          </SettingsGroup>

          <SettingsGroup title="Remote Debug">
            <SettingsGroupItem>
              <div className="flex justify-between items-center">
                <span>Enable Remote Debug</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={debugMode}
                  onChange={toggleDebugMode}
                />
              </div>
            </SettingsGroupItem>

            <SettingsGroupItem isLast={!debugMode}>
              <div className="flex justify-between items-center">
                <div className="flex flex-col">
                  <span>Preserve Debug Session</span>
                  <span className="text-sm text-base-content/60">
                    Keep the same debug session across app restarts
                  </span>
                </div>
                <input
                  type="checkbox"
                  className="toggle toggle-secondary"
                  checked={preserveDebugSession}
                  onChange={togglePreserveDebugSession}
                />
              </div>
            </SettingsGroupItem>

            {debugMode && debugSessionLink && (
              <>
                <SettingsGroupItem>
                  <div className="flex flex-col space-y-2">
                    <span className="text-sm text-base-content/70">
                      Debug Session Link:
                    </span>
                    <a
                      href={debugSessionLink}
                      className="link link-primary text-xs break-all"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {debugSessionLink}
                    </a>
                    <CopyButton
                      copyStr={debugSessionLink}
                      text="Copy Link"
                      className="btn btn-sm btn-primary mt-2"
                    />
                  </div>
                </SettingsGroupItem>

                <SettingsGroupItem isLast>
                  <div className="flex flex-col space-y-2">
                    <span className="text-sm text-base-content/70">
                      Test Sync (syncs with debug page):
                    </span>
                    <input
                      type="text"
                      value={testValue}
                      onChange={handleTestInputChange}
                      placeholder="Type something to test sync..."
                      className="bg-base-200 rounded-lg px-3 py-2 text-sm border border-base-content/20"
                    />
                  </div>
                </SettingsGroupItem>
              </>
            )}
          </SettingsGroup>

          <SettingsGroup title="Local Debug">
            <SettingsGroupItem isLast>
              <LogViewer />
            </SettingsGroupItem>
          </SettingsGroup>
        </div>
      </div>
    </div>
  )
}
