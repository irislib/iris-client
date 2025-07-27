import React, {useEffect, useState, useRef} from "react"
import {DebugSession} from "./DebugSession"
import {NostrEvent} from "nostr-tools"

interface SystemInfo {
  appVersion: string
  buildTime: string
  memoryUsage: {
    used: number
    total: number
  } | null
}

interface NdkInfo {
  subscriptionsCount: number
  seenEventsCount: number
  subscriptionIds: string[]
  relayCount: number
  connectedRelays: string[]
}

interface MediaFeedDebug {
  timestamp: number
  renderCount: number
  eventsTotal: number
  eventsVisible: number
  fetchedEventsMapSize: number
  modalMediaLength: number
  showModal: boolean
  activeItemIndex: number | null
  memoryEstimate: number
  userAgent: string
}

interface MediaFeedPerformance {
  operation: string
  duration: number
  eventsProcessed?: number
  mediaItemsFound?: number
  allEventsCount?: number
  mediaArrayLength?: number
  mediaIndex?: number
  timestamp: number
}

interface MediaFeedMemory {
  operation: string
  eventsRemoved?: number
  remainingEvents?: number
  visibleEventsCount?: number
  oldSize?: number
  newSize?: number
  timestamp: number
}

interface SubscriptionData {
  filters: unknown[]
  relays: string[]
}

const DebugApp = () => {
  const [session, setSession] = useState<DebugSession | null>(null)
  const [sessionLink, setSessionLink] = useState<string>("")
  const [testValue, setTestValue] = useState<string>("")
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(false)
  const lastHeartbeatTime = useRef<number>(0)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [ndkInfo, setNdkInfo] = useState<NdkInfo | null>(null)
  const [mediaFeedDebug, setMediaFeedDebug] = useState<MediaFeedDebug | null>(null)
  const [mediaFeedPerformance, setMediaFeedPerformance] = useState<
    MediaFeedPerformance[]
  >([])
  const [mediaFeedMemory, setMediaFeedMemory] = useState<MediaFeedMemory[]>([])
  const [subscriptions, setSubscriptions] = useState<Record<
    string,
    SubscriptionData
  > | null>(null)
  const [userAgent, setUserAgent] = useState<string>("")
  const [currentUrl, setCurrentUrl] = useState<string>("")

  const TEMP_IRIS_RELAY = "wss://temp.iris.to/"

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
    // Get private key from URL hash
    const hash = window.location.hash.slice(1) // Remove the #
    const privateKey = hash || undefined

    // Create debug session
    const debugSession = new DebugSession(privateKey)
    setSession(debugSession)

    // If no private key was provided, add the generated one to the URL hash
    if (!privateKey) {
      window.location.hash = debugSession.getPrivateKey()
    }

    // Always create a session link with the current private key
    const linkWithKey = `${window.location.origin}${window.location.pathname}#${debugSession.getPrivateKey()}`
    setSessionLink(linkWithKey)

    // Subscribe to test value changes
    const unsubscribeTest = debugSession.subscribe("testInput", (value: unknown) => {
      if (typeof value === "string") {
        setTestValue(value)
      }
    })

    // Subscribe to subscriptions data
    const unsubscribeSubscriptions = debugSession.subscribe(
      "subscriptions",
      (value: unknown) => {
        setSubscriptions(value as Record<string, SubscriptionData>)
      }
    )

    // Subscribe to heartbeat data to check if Iris browser is online
    const unsubscribeData = debugSession.subscribe(
      "data",
      (value: unknown, event: NostrEvent | undefined) => {
        const eventTime = event?.created_at // Event timestamp in seconds
        if (eventTime) {
          lastHeartbeatTime.current = eventTime // Store in seconds
          const now = Math.floor(Date.now() / 1000) // Current time in seconds
          const isRecent = now - eventTime < 10 // Less than 10 seconds old
          setIsBrowserOnline(isRecent)
        }

        // Extract system info from heartbeat
        const data = value as {
          systemInfo?: SystemInfo
          ndkInfo?: NdkInfo
          userAgent?: string
          url?: string
        }
        if (data && data.systemInfo) {
          setSystemInfo(data.systemInfo)
        }
        if (data && data.ndkInfo) {
          setNdkInfo(data.ndkInfo)
        }
        if (data && data.userAgent) {
          setUserAgent(data.userAgent)
        }
        if (data && data.url) {
          setCurrentUrl(data.url)
        }
      }
    )

    // Subscribe to MediaFeed debug data
    const unsubscribeMediaFeedDebug = debugSession.subscribe(
      "mediaFeed_debug",
      (value: unknown) => {
        setMediaFeedDebug(value as MediaFeedDebug)
      }
    )

    // Subscribe to MediaFeed performance data
    const unsubscribeMediaFeedPerformance = debugSession.subscribe(
      "mediaFeed_performance",
      (value: unknown) => {
        setMediaFeedPerformance((prev) => {
          const newEntry = value as MediaFeedPerformance
          // Keep only last 20 performance entries to avoid memory buildup
          const updated = [newEntry, ...prev].slice(0, 20)
          return updated
        })
      }
    )

    // Subscribe to MediaFeed memory data
    const unsubscribeMediaFeedMemory = debugSession.subscribe(
      "mediaFeed_memory",
      (value: unknown) => {
        setMediaFeedMemory((prev) => {
          const newEntry = value as MediaFeedMemory
          // Keep only last 20 memory entries to avoid memory buildup
          const updated = [newEntry, ...prev].slice(0, 20)
          return updated
        })
      }
    )

    // Monitor connection status periodically
    const checkConnection = () => {
      setIsConnected(debugSession.isConnectedToRelay())
    }

    // Check heartbeat freshness periodically
    const checkHeartbeatFreshness = () => {
      if (lastHeartbeatTime.current > 0) {
        const now = Math.floor(Date.now() / 1000) // Current time in seconds
        const isRecent = now - lastHeartbeatTime.current < 10 // Both in seconds
        setIsBrowserOnline(isRecent)
      }
    }

    // Check connection every 500ms for more responsive updates
    const connectionInterval = setInterval(checkConnection, 500)

    // Check heartbeat freshness every 1 second
    const heartbeatInterval = setInterval(checkHeartbeatFreshness, 1000)

    return () => {
      clearInterval(connectionInterval)
      clearInterval(heartbeatInterval)
      unsubscribeTest()
      unsubscribeData()
      unsubscribeSubscriptions()
      unsubscribeMediaFeedDebug()
      unsubscribeMediaFeedPerformance()
      unsubscribeMediaFeedMemory()
      debugSession.close()
    }
  }, [])

  const handleTestInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setTestValue(newValue)
    session?.publish("testInput", newValue)
  }

  return (
    <div className="container mx-auto p-8">
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h1 className="card-title text-3xl mb-4">Iris Debug Tool</h1>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="stat bg-base-200 rounded">
                <div className="stat-title">Relay Status</div>
                <div
                  className={`stat-value ${isConnected ? "text-success" : "text-error"}`}
                >
                  {isConnected ? "Online" : "Offline"}
                </div>
                <div className="stat-desc text-xs opacity-70">{TEMP_IRIS_RELAY}</div>
              </div>

              <div className="stat bg-base-200 rounded">
                <div className="stat-title">Iris Browser</div>
                <div
                  className={`stat-value ${isBrowserOnline ? "text-success" : "text-error"}`}
                >
                  {isBrowserOnline ? "Online" : "Offline"}
                </div>
                <div className="stat-desc text-xs opacity-70">
                  {lastHeartbeatTime.current > 0
                    ? `Last: ${new Date(lastHeartbeatTime.current * 1000).toLocaleTimeString()}`
                    : "No heartbeat received"}
                </div>
              </div>
            </div>

            {systemInfo && <div className="divider">System Information</div>}

            {systemInfo && (
              <div className="card bg-base-200 shadow">
                <div className="card-body">
                  <h3 className="card-title">
                    Iris Browser Info
                    <span className="badge badge-success badge-sm">Live</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div>App Version:</div>
                    <div>{systemInfo.appVersion}</div>
                    <div>Build Time:</div>
                    <div>{formatBuildTime(systemInfo.buildTime)}</div>
                    {systemInfo.memoryUsage && (
                      <>
                        <div>Memory Usage:</div>
                        <div>
                          {systemInfo.memoryUsage.used}MB / {systemInfo.memoryUsage.total}
                          MB
                        </div>
                      </>
                    )}
                    {userAgent && (
                      <>
                        <div>User Agent:</div>
                        <div className="text-xs break-all">{userAgent}</div>
                      </>
                    )}
                    {currentUrl && (
                      <>
                        <div>Current URL:</div>
                        <div className="text-xs break-all">{currentUrl}</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {ndkInfo && <div className="divider">NDK Information</div>}

            {ndkInfo && (
              <div className="card bg-base-200 shadow">
                <div className="card-body">
                  <h3 className="card-title">
                    NDK Subscription Manager
                    <span className="badge badge-info badge-sm">Live</span>
                  </h3>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div>Active Subscriptions:</div>
                      <div>{ndkInfo.subscriptionsCount}</div>
                      <div>Seen Events:</div>
                      <div>{ndkInfo.seenEventsCount.toLocaleString()}</div>
                      <div>Total Relays:</div>
                      <div>{ndkInfo.relayCount}</div>
                      <div>Connected Relays:</div>
                      <div>{ndkInfo.connectedRelays.length}</div>
                    </div>
                    <details className="collapse collapse-arrow bg-base-300">
                      <summary className="collapse-title text-sm font-medium">
                        View Raw NDK Data
                      </summary>
                      <div className="collapse-content">
                        <pre className="text-xs bg-base-100 p-2 rounded overflow-auto max-h-60">
                          {JSON.stringify(ndkInfo, null, 2)}
                        </pre>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            )}

            {subscriptions && <div className="divider">Active Subscriptions</div>}

            {subscriptions && (
              <div className="card bg-base-200 shadow">
                <div className="card-body">
                  <h3 className="card-title">
                    Subscription Details ({Object.keys(subscriptions).length} total)
                    <span className="badge badge-warning badge-sm">Live</span>
                  </h3>
                  <div className="overflow-x-auto max-h-96">
                    <table className="table table-xs">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Filters</th>
                          <th>Relays</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(subscriptions).map(([id, data]) => (
                          <tr key={id}>
                            <td className="font-mono text-xs">{id}</td>
                            <td className="text-xs max-w-md">
                              <pre className="whitespace-pre-wrap break-all">
                                {JSON.stringify(data.filters, null)}
                              </pre>
                            </td>
                            <td className="text-xs">
                              {data.relays.map((relay, i) => (
                                <div key={i} className="truncate">
                                  {relay}
                                </div>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {mediaFeedDebug && <div className="divider">MediaFeed Debug</div>}

            {mediaFeedDebug && (
              <div className="card bg-base-200 shadow">
                <div className="card-body">
                  <h3 className="card-title">
                    MediaFeed Status
                    <span className="badge badge-warning badge-sm">Live</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div>Render Count:</div>
                    <div>{mediaFeedDebug.renderCount}</div>
                    <div>Total Events:</div>
                    <div>{mediaFeedDebug.eventsTotal}</div>
                    <div>Visible Events:</div>
                    <div>{mediaFeedDebug.eventsVisible}</div>
                    <div>Fetched Events:</div>
                    <div>{mediaFeedDebug.fetchedEventsMapSize}</div>
                    <div>Modal Media:</div>
                    <div>{mediaFeedDebug.modalMediaLength}</div>
                    <div>Modal Open:</div>
                    <div>{mediaFeedDebug.showModal ? "Yes" : "No"}</div>
                    <div>Memory Estimate:</div>
                    <div>{mediaFeedDebug.memoryEstimate}KB</div>
                    <div>Last Update:</div>
                    <div>{new Date(mediaFeedDebug.timestamp).toLocaleTimeString()}</div>
                  </div>
                </div>
              </div>
            )}

            {mediaFeedPerformance.length > 0 && (
              <div className="card bg-base-200 shadow">
                <div className="card-body">
                  <h3 className="card-title">
                    MediaFeed Performance
                    <span className="badge badge-error badge-sm">Issues</span>
                  </h3>
                  <div className="overflow-x-auto max-h-60">
                    <table className="table table-xs">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Operation</th>
                          <th>Duration (ms)</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mediaFeedPerformance.map((perf, index) => (
                          <tr
                            key={index}
                            className={perf.duration > 50 ? "bg-error/20" : ""}
                          >
                            <td>{new Date(perf.timestamp).toLocaleTimeString()}</td>
                            <td>{perf.operation}</td>
                            <td className={perf.duration > 50 ? "text-error" : ""}>
                              {perf.duration}
                            </td>
                            <td className="text-xs">
                              {perf.eventsProcessed && `Events: ${perf.eventsProcessed}`}
                              {perf.mediaItemsFound && ` Media: ${perf.mediaItemsFound}`}
                              {perf.allEventsCount &&
                                ` AllEvents: ${perf.allEventsCount}`}
                              {perf.mediaArrayLength &&
                                ` MediaArray: ${perf.mediaArrayLength}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {mediaFeedMemory.length > 0 && (
              <div className="card bg-base-200 shadow">
                <div className="card-body">
                  <h3 className="card-title">
                    MediaFeed Memory
                    <span className="badge badge-secondary badge-sm">Activity</span>
                  </h3>
                  <div className="overflow-x-auto max-h-60">
                    <table className="table table-xs">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Operation</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mediaFeedMemory.map((mem, index) => (
                          <tr key={index}>
                            <td>{new Date(mem.timestamp).toLocaleTimeString()}</td>
                            <td>{mem.operation}</td>
                            <td className="text-xs">
                              {mem.eventsRemoved && `Removed: ${mem.eventsRemoved}`}
                              {mem.remainingEvents &&
                                ` Remaining: ${mem.remainingEvents}`}
                              {mem.oldSize &&
                                mem.newSize &&
                                ` ${mem.oldSize}→${mem.newSize}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            <div className="divider">Debug Session</div>

            {session && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="card bg-base-200 shadow">
                  <div className="card-body">
                    <h3 className="card-title">Session Info</h3>
                    <div className="space-y-2">
                      <div>
                        <span className="font-semibold">Public Key:</span>
                        <div className="text-xs font-mono break-all">
                          {session.getPublicKey()}
                        </div>
                      </div>
                      <div>
                        <span className="font-semibold">Private Key:</span>
                        <div className="text-xs font-mono break-all">
                          {session.getPrivateKey()}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {sessionLink && (
                  <div className="card bg-base-200 shadow">
                    <div className="card-body">
                      <h3 className="card-title">Session Link</h3>
                      <p className="text-sm mb-2">
                        Use this link to access the same debug session:
                      </p>
                      <a
                        href={sessionLink}
                        className="link link-primary text-xs break-all"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {sessionLink}
                      </a>
                      <button
                        className="btn btn-sm btn-primary mt-2"
                        onClick={() => navigator.clipboard.writeText(sessionLink)}
                      >
                        Copy Link
                      </button>
                    </div>
                  </div>
                )}

                <div className="card bg-base-200 shadow">
                  <div className="card-body">
                    <h3 className="card-title">Test Sync</h3>
                    <p className="text-sm mb-2">
                      This input syncs across all sessions with the same private key:
                    </p>
                    <input
                      type="text"
                      value={testValue}
                      onChange={handleTestInputChange}
                      placeholder="Type something to test sync..."
                      className="input input-bordered w-full"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default DebugApp
