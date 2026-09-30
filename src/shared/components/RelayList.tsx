import {useState} from "react"
import {Link} from "@/navigation"
import {RiAddLine, RiCloseLine, RiDeleteBinLine} from "@remixicon/react"
import {useUserStore, RelayConfig} from "@/stores/user"
import {useWorkerRelayStatus} from "@/shared/hooks/useWorkerRelayStatus"

interface RelayListProps {
  compact?: boolean
  showDelete?: boolean
  showAddRelay?: boolean
  showDiscovered?: boolean
  className?: string
  itemClassName?: string
  maxHeight?: string
}

export function RelayList({
  compact = false,
  showDelete = false,
  showAddRelay = true,
  showDiscovered = false,
  className = "",
  itemClassName = "",
  maxHeight = "max-h-64",
}: RelayListProps) {
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customRelay, setCustomRelay] = useState("")
  const [showDiscoveredRelays, setShowDiscoveredRelays] = useState(false)
  const [showSavedRelays, setShowSavedRelays] = useState(true)
  const {relayConfigs, toggleRelayConnection, addRelay, removeRelay} = useUserStore()
  const workerRelays = useWorkerRelayStatus()

  const normalizeRelayUrl = (url: string) => {
    // Normalize URL for comparison: remove trailing slash and ensure lowercase
    return url.replace(/\/$/, "").toLowerCase()
  }

  // Get relay map from worker
  const ndkRelayMap = new Map(
    workerRelays.relays.map((r) => [r.url, {connected: r.status >= 5, url: r.url}])
  )

  // Separate multicast relay from discovered relays
  const multicastRelay = Array.from(ndkRelayMap.entries()).find(
    ([url]) => url === "multicast" || url.startsWith("multicast://")
  )

  const discoveredRelays = Array.from(ndkRelayMap.entries()).filter(([url]) => {
    const normalizedNdkUrl = normalizeRelayUrl(url)
    const isInConfigs = relayConfigs?.some(
      (c) => normalizeRelayUrl(c.url) === normalizedNdkUrl
    )

    // Filter out multicast and saved relays
    return !isInConfigs && url !== "multicast" && !url.startsWith("multicast://")
  })

  // Sort relays alphabetically
  const sortedRelayConfigs = [...(relayConfigs || [])].sort((a, b) => {
    return a.url.localeCompare(b.url)
  })

  const handleAddCustomRelay = () => {
    if (customRelay.trim()) {
      let url = customRelay.trim()
      if (!url.startsWith("wss://") && !url.startsWith("ws://")) {
        url = `wss://${url}`
      }
      // Ensure trailing slash for consistency with NostrClient normalization
      if (!url.endsWith("/")) {
        url = url + "/"
      }

      // Check if relay already exists
      if (!relayConfigs?.some((c) => c.url === url)) {
        addRelay(url, false) // false = not disabled (enabled)
      }

      setCustomRelay("")
      setShowCustomInput(false)
    }
  }

  const getRelay = (config: RelayConfig) => {
    let relay = ndkRelayMap.get(config.url)
    if (!relay && !config.url.endsWith("/")) {
      relay = ndkRelayMap.get(config.url + "/")
    }
    if (!relay && config.url.endsWith("/")) {
      relay = ndkRelayMap.get(config.url.slice(0, -1))
    }
    return relay
  }

  const iconSize = compact ? "w-3 h-3" : "w-5 h-5"
  const textSize = compact ? "text-xs" : "text-lg"
  const padding = compact ? "py-0.5" : "py-2"
  const buttonPadding = compact ? "p-0.5" : "p-1"

  return (
    <div className={className}>
      <div
        className={`${compact ? "space-y-0.5" : "divide-y divide-base-300"} ${maxHeight} overflow-y-auto ${compact ? "pr-1" : ""}`}
      >
        {showAddRelay && (
          <>
            {!showCustomInput ? (
              <button
                onClick={() => setShowCustomInput(true)}
                className={`flex items-center gap-2 ${textSize} hover:opacity-100 transition-opacity group ${padding} w-full text-left link link-info`}
              >
                <RiAddLine className={`${iconSize} flex-shrink-0`} />
                <span>Add relay</span>
              </button>
            ) : (
              <div className={`flex gap-1 items-center ${compact ? "mb-1" : "pb-2"}`}>
                <input
                  type="text"
                  placeholder="wss://relay.example.com"
                  value={customRelay}
                  onChange={(e) => setCustomRelay(e.target.value)}
                  className={`input ${compact ? "input-xs" : "input-sm"} flex-1 ${textSize}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleAddCustomRelay()
                    } else if (e.key === "Escape") {
                      setShowCustomInput(false)
                      setCustomRelay("")
                    }
                  }}
                  autoFocus
                />
                <button
                  onClick={handleAddCustomRelay}
                  className={`btn ${compact ? "btn-xs" : "btn-sm"} btn-primary px-2`}
                >
                  Add
                </button>
                <button
                  onClick={() => {
                    setShowCustomInput(false)
                    setCustomRelay("")
                  }}
                  className={`btn ${compact ? "btn-xs" : "btn-sm"} btn-ghost ${buttonPadding}`}
                >
                  <RiCloseLine className={iconSize} />
                </button>
              </div>
            )}
          </>
        )}

        {/* Saved relays section */}
        {sortedRelayConfigs.length > 0 && (
          <>
            <button
              onClick={() => setShowSavedRelays(!showSavedRelays)}
              className={`flex items-center gap-2 ${textSize} ${padding} text-base-content/60 font-semibold hover:opacity-100 transition-opacity w-full text-left hover:underline`}
            >
              <span>
                {showSavedRelays ? "▼" : "▶"} Saved relays ({sortedRelayConfigs.length})
              </span>
            </button>

            {showSavedRelays &&
              sortedRelayConfigs.map((config) => {
                const relay = getRelay(config)
                const isEnabled = !config.disabled
                const isConnected = isEnabled && relay?.connected
                const displayUrl = config.url.replace(/^wss?:\/\//, "").replace(/\/$/, "")

                return (
                  <div
                    key={config.url}
                    className={`flex items-center justify-between ${padding} ${itemClassName}`}
                  >
                    <Link
                      to={`/relay/${encodeURIComponent(displayUrl)}`}
                      className={`${textSize} font-medium link link-info flex-1 ${
                        compact && (isEnabled ? "opacity-80" : "opacity-40")
                      }`}
                    >
                      {displayUrl}
                    </Link>
                    <div className={`flex items-center ${compact ? "gap-2" : "gap-4"}`}>
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={() => toggleRelayConnection(config.url)}
                        className="toggle toggle-primary toggle-sm"
                        title={isEnabled ? "Disconnect from relay" : "Connect to relay"}
                      />
                      {showDelete && (
                        <RiDeleteBinLine
                          className={`${iconSize} cursor-pointer`}
                          onClick={() => removeRelay(config.url)}
                        />
                      )}
                      {compact ? (
                        <div
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${(() => {
                            if (isConnected) return "bg-success"
                            if (isEnabled) return "bg-warning"
                            return "bg-error"
                          })()}`}
                        />
                      ) : (
                        <span
                          className={`badge ${(() => {
                            if (isConnected) return "badge-success"
                            if (isEnabled) return "badge-warning"
                            return "badge-error"
                          })()}`}
                        ></span>
                      )}
                    </div>
                  </div>
                )
              })}
          </>
        )}

        {/* Multicast relay section */}
        {multicastRelay && (
          <div className={`${padding} ${itemClassName} opacity-80`}>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className={`${textSize} font-medium text-base-content/80`}>
                  Local network discovery
                </div>
                <div
                  className={`${compact ? "text-[10px]" : "text-xs"} text-base-content/40`}
                >
                  {multicastRelay[0]}
                </div>
              </div>
              <div className={`flex items-center ${compact ? "gap-2" : "gap-4"}`}>
                {compact ? (
                  <div
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      multicastRelay[1].connected ? "bg-success" : "bg-warning"
                    }`}
                  />
                ) : (
                  <span
                    className={`badge ${
                      multicastRelay[1].connected ? "badge-success" : "badge-warning"
                    }`}
                  ></span>
                )}
              </div>
            </div>
          </div>
        )}

        {showDiscovered && (
          <>
            <button
              onClick={() => setShowDiscoveredRelays(!showDiscoveredRelays)}
              className={`flex items-center gap-2 ${textSize} ${padding} text-base-content/60 font-semibold hover:opacity-100 transition-opacity w-full text-left hover:underline`}
            >
              <span>
                {showDiscoveredRelays ? "▼" : "▶"} Discovered relays (
                {discoveredRelays.length})
              </span>
            </button>

            {showDiscoveredRelays && (
              <>
                {discoveredRelays.length > 0 ? (
                  discoveredRelays
                    .sort(([urlA], [urlB]) => {
                      // Sort alphabetically
                      return urlA.localeCompare(urlB)
                    })
                    .map(([url, relay]) => {
                      const displayUrl = url.replace(/^wss?:\/\//, "").replace(/\/$/, "")
                      return (
                        <div
                          key={url}
                          className={`flex items-center justify-between ${padding} ${itemClassName} opacity-60`}
                        >
                          <Link
                            to={`/relay/${encodeURIComponent(displayUrl)}`}
                            className={`${textSize} font-medium link link-info flex-1`}
                          >
                            {displayUrl}
                          </Link>
                          <div
                            className={`flex items-center ${compact ? "gap-2" : "gap-4"}`}
                          >
                            <button
                              onClick={() => addRelay(url, false)}
                              className={`${buttonPadding} hover:bg-base-${compact ? "300" : "200"} rounded transition-colors flex-shrink-0`}
                              title="Add to your saved relays"
                            >
                              <RiAddLine className={`${iconSize} text-success`} />
                            </button>
                            {compact ? (
                              <div
                                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                  relay.connected ? "bg-success" : "bg-base-300"
                                }`}
                              />
                            ) : (
                              <span
                                className={`badge ${
                                  relay.connected ? "badge-success" : "badge-ghost"
                                }`}
                              ></span>
                            )}
                          </div>
                        </div>
                      )
                    })
                ) : (
                  <div className={`${textSize} ${padding} text-base-content/40 italic`}>
                    No new relays discovered
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
