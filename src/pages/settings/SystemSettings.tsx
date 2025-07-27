import React, {useState, useEffect} from "react"
import Debug from "@/utils/DebugManager"
import {useSettingsStore} from "@/stores/settings"

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
  const {debug} = useSettingsStore()

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
    const updateMemoryUsage = () => {
      if (
        typeof performance !== "undefined" &&
        "memory" in performance &&
        performance.memory
      ) {
        const perfMemory = (
          performance as {memory: {usedJSHeapSize: number; jsHeapSizeLimit: number}}
        ).memory
        setMemoryUsage({
          used: Math.round(perfMemory?.usedJSHeapSize / 1024 / 1024),
          total: Math.round(perfMemory?.jsHeapSizeLimit / 1024 / 1024),
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
      navigator.serviceWorker.ready.then((registration) => {
        registration.addEventListener("controllerchange", () => {
          setUpdateAvailable(true)
        })
      })
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

  const handleTestInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setTestValue(newValue)
    const debugSession = Debug.getDebugSession()
    debugSession?.publish("testInput", newValue)
  }

  const refreshApp = () => {
    window.location.reload()
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl mb-4">System</h2>

      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <h3 className="card-title">Maintenance</h3>
          <div>
            <button
              className={`btn btn-primary w-full ${updateAvailable ? "animate-pulse" : ""}`}
              onClick={refreshApp}
            >
              {updateAvailable
                ? "Update Available - Click to Refresh"
                : "Refresh Application"}
            </button>
            <p className="text-sm text-base-content/70 mt-1">
              Reload the application to apply any pending updates or fix weirdness.
            </p>
          </div>
        </div>
      </div>

      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <h3 className="card-title">Debug Information</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>App Version:</div>
            <div>{appVersion}</div>
            <div>Build Time:</div>
            <div>{formatBuildTime(buildTime)}</div>
            {memoryUsage && (
              <>
                <div>Memory Usage:</div>
                <div>
                  {memoryUsage.used}MB / {memoryUsage.total}MB
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <h3 className="card-title">Debug Mode</h3>
          <div className="space-y-4">
            <div className="form-control">
              <label className="label cursor-pointer">
                <span className="label-text">Enable Debug Mode</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={debugMode}
                  onChange={toggleDebugMode}
                />
              </label>
            </div>

            <div className="form-control">
              <label className="label cursor-pointer">
                <span className="label-text">Preserve Debug Session</span>
                <input
                  type="checkbox"
                  className="toggle toggle-secondary"
                  checked={preserveDebugSession}
                  onChange={togglePreserveDebugSession}
                />
              </label>
              <div className="label">
                <span className="label-text-alt text-xs opacity-70">
                  Keep the same debug session across app restarts
                </span>
              </div>
            </div>
          </div>

          {debugMode && debugSessionLink && (
            <div className="mt-4 space-y-4">
              <div>
                <label className="label">
                  <span className="label-text">Debug Session Link:</span>
                </label>
                <a
                  href={debugSessionLink}
                  className="link link-primary text-xs break-all"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {debugSessionLink}
                </a>
              </div>

              <div>
                <label className="label">
                  <span className="label-text">Test Sync (syncs with debug page):</span>
                </label>
                <input
                  type="text"
                  value={testValue}
                  onChange={handleTestInputChange}
                  placeholder="Type something to test sync..."
                  className="input input-bordered w-full"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
