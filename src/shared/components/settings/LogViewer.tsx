import {useState, useEffect} from "react"
import {
  getLogs,
  getNamespaces,
  clearLogs,
  subscribeLogs,
  LogEntry,
} from "@/utils/logCollector"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {getNamespaceColor, extractAndColorPeerId} from "@/utils/namespaceColors"
import {useDebugStore} from "@/stores/debug"

export function LogViewer() {
  const [isExpanded, setIsExpanded] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [filter, setFilter] = useState("")
  const [levelFilter, setLevelFilter] = useState<"all" | "log" | "warn" | "error">("all")
  const {
    filter: debugFilter,
    enabled: isEnabled,
    setFilter: setDebugFilter,
    toggleDebug,
  } = useDebugStore()

  // Subscribe to log changes
  useEffect(() => {
    const unsubscribe = subscribeLogs(() => {
      setLogs(getLogs())
      setNamespaces(getNamespaces())
    })
    // Initial load
    setLogs(getLogs())
    setNamespaces(getNamespaces())
    return unsubscribe
  }, [])

  const filteredLogs = logs
    .filter((log) => {
      if (
        filter &&
        !log.namespace.includes(filter) &&
        !log.message.toLowerCase().includes(filter.toLowerCase())
      )
        return false
      if (levelFilter !== "all" && log.level !== levelFilter) return false
      return true
    })
    .reverse()

  const handleExport = () => {
    const csv = [
      ["Timestamp", "Namespace", "Level", "Message"],
      ...filteredLogs.map((log) => [
        new Date(log.timestamp).toISOString(),
        log.namespace,
        log.level,
        JSON.stringify(log.message),
      ]),
    ]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n")

    const blob = new Blob([csv], {type: "text/csv"})
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `logs-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCopyLogs = () => {
    const text = filteredLogs
      .map(
        (log) =>
          `[${new Date(log.timestamp).toISOString()}] ${log.level.toUpperCase()}\t${log.namespace}\t${log.message}`
      )
      .join("\n")
    navigator.clipboard.writeText(text)
  }

  const handleDebugFilterChange = (newFilter: string) => {
    setDebugFilter(newFilter)
  }

  const toggleLogger = () => {
    toggleDebug()
  }

  const toggleNamespace = (namespace: string) => {
    const currentFilter = debugFilter
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean)
    const isIncluded = currentFilter.includes(namespace)

    let newFilter: string
    if (isIncluded) {
      newFilter = currentFilter.filter((f) => f !== namespace).join(",")
    } else {
      newFilter = [...currentFilter, namespace].join(",")
    }

    handleDebugFilterChange(newFilter)
  }

  const namespacesList = Object.values(DEBUG_NAMESPACES) as string[]

  const getLogColor = (level: string): string => {
    if (level === "error") return "text-error"
    if (level === "warn") return "text-warning"
    return "text-base-content"
  }

  const getLogEmoji = (level: string): string => {
    if (level === "error") return "❌"
    if (level === "warn") return "⚠️"
    return "📝"
  }

  return (
    <div className="flex flex-col space-y-3">
      <div className="flex justify-between items-center">
        <button onClick={() => setIsExpanded(!isExpanded)} className="flex-1 text-left">
          <span className="text-sm text-base-content/70">
            {logs.length} {logs.length === 1 ? "log" : "logs"}
          </span>
        </button>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={toggleLogger}
              className="checkbox checkbox-sm"
            />
            <span className="text-sm">{isEnabled ? "On" : "Off"}</span>
          </label>
          <span className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}>
            ▼
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="space-y-3">
          {/* Debug Filter Input */}
          <div className="flex flex-col space-y-1">
            <label className="text-sm font-medium">Debug Namespace Filter</label>
            <input
              type="text"
              value={debugFilter}
              onChange={(e) => handleDebugFilterChange(e.target.value)}
              placeholder="e.g., ndk:*, cashu:wallet, or ui:feed"
              className="bg-base-200 rounded-lg px-3 py-2 text-sm border border-base-content/20"
            />
            <p className="text-xs text-base-content/60">
              Format: namespace patterns separated by commas. Use * for wildcard.
              Examples: ndk:relay, ndk:subscription, cashu:wallet, ui:feed
            </p>
          </div>

          {/* Namespace Selector */}
          <div className="flex flex-col space-y-2">
            <label className="text-sm font-medium">Quick Add Namespaces</label>
            <div className="bg-base-200 rounded-lg p-2 max-h-48 overflow-y-auto space-y-1">
              {namespacesList.map((ns) => {
                const isSelected = debugFilter
                  .split(",")
                  .map((f) => f.trim())
                  .includes(ns)
                return (
                  <label
                    key={ns}
                    className="flex items-center gap-2 cursor-pointer p-1 hover:bg-base-300 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleNamespace(ns)}
                      className="checkbox checkbox-sm"
                    />
                    <span
                      className={`text-xs font-mono flex-1 px-1.5 py-0.5 rounded ${getNamespaceColor(ns)}`}
                    >
                      {ns}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Filter Controls */}
          <div className="flex gap-2 flex-wrap">
            <div className="flex-1 min-w-[150px]">
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter logs..."
                className="w-full bg-base-200 rounded-lg px-3 py-2 text-sm border border-base-content/20"
              />
            </div>
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as typeof levelFilter)}
              className="bg-base-200 rounded-lg px-3 py-2 text-sm border border-base-content/20"
            >
              <option value="all">All Levels</option>
              <option value="log">Log</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </div>

          {/* Log Display */}
          <div className="bg-base-300 rounded-lg p-3 font-mono text-xs space-y-1 max-h-64 overflow-y-auto select-text">
            {filteredLogs.length === 0 ? (
              <div className="text-base-content/40">No logs to display</div>
            ) : (
              filteredLogs.map((log, idx) => {
                const message =
                  typeof log.message === "string"
                    ? log.message
                    : JSON.stringify(log.message)
                const peerInfo = extractAndColorPeerId(message)
                return (
                  <div
                    key={idx}
                    className={`flex gap-2 flex-wrap items-baseline ${getLogColor(log.level)}`}
                  >
                    <span className="text-base-content/50 flex-shrink-0 min-w-fit">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="flex-shrink-0 w-6">{getLogEmoji(log.level)}</span>
                    <span
                      className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-mono ${getNamespaceColor(log.namespace)}`}
                    >
                      {log.namespace}
                    </span>
                    {peerInfo.color && (
                      <span
                        className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-mono font-semibold ${peerInfo.color}`}
                      >
                        {peerInfo.text}
                      </span>
                    )}
                    <span className="flex-1 break-all text-base-content/80 min-w-fit">
                      {message}
                    </span>
                  </div>
                )
              })
            )}
          </div>

          {/* Statistics */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-base-200 rounded px-2 py-1">
              <div className="text-base-content/60">Total</div>
              <div className="font-semibold">{logs.length}</div>
            </div>
            <div className="bg-base-200 rounded px-2 py-1">
              <div className="text-base-content/60">Namespaces</div>
              <div className="font-semibold">{namespaces.length}</div>
            </div>
            <div className="bg-base-200 rounded px-2 py-1">
              <div className="text-base-content/60">Filtered</div>
              <div className="font-semibold">{filteredLogs.length}</div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleCopyLogs}
              className="btn btn-sm btn-outline flex-1 min-w-[100px]"
            >
              Copy
            </button>
            <button
              onClick={handleExport}
              className="btn btn-sm btn-outline flex-1 min-w-[100px]"
            >
              Export CSV
            </button>
            <button
              onClick={clearLogs}
              className="btn btn-sm btn-outline flex-1 min-w-[100px]"
            >
              Clear
            </button>
          </div>

          {/* Namespace List */}
          {namespaces.length > 0 && (
            <div className="border-t border-base-content/20 pt-2">
              <p className="text-xs font-semibold text-base-content/70 mb-2">
                Active Namespaces:
              </p>
              <div className="flex flex-wrap gap-1">
                {namespaces.map((ns) => (
                  <button
                    key={ns}
                    onClick={() => setFilter(ns)}
                    className={`${getNamespaceColor(ns)} rounded px-2 py-1 text-xs font-mono transition hover:opacity-75`}
                  >
                    {ns}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
