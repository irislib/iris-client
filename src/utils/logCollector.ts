/**
 * Log collector service for capturing debug output
 * Uses debug pkg's logger with ring buffer
 */

import {useDebugStore} from "@/stores/debug"

export interface LogEntry {
  timestamp: number
  namespace: string
  level: "log" | "warn" | "error"
  message: string
}

const MAX_LOGS = 500
const logs: LogEntry[] = []
const subscribers: Set<() => void> = new Set()

// BroadcastChannel for worker → main thread log forwarding
const logChannel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("debug-logs") : null

/**
 * Initialize log collection by patching debug output
 */
export function initializeLogCollection(): void {
  // Intercept localStorage debug settings to track enabled namespaces
  if (typeof localStorage !== "undefined") {
    const originalSetItem = localStorage.setItem
    localStorage.setItem = function (key: string, value: string) {
      if (key === "debug") {
        // User changed debug filter
        notifySubscribers()
      }
      originalSetItem.call(this, key, value)
    }
  }

  // Listen for logs from workers (main thread only)
  if (typeof window !== "undefined" && logChannel) {
    logChannel.addEventListener("message", (event) => {
      const entry = event.data as LogEntry
      logs.push(entry)
      if (logs.length > MAX_LOGS) {
        logs.shift()
      }
      notifySubscribers()
    })
  }
}

/**
 * Check if a namespace is enabled in the debug filter
 * Reads from Zustand store for reactive state
 */
function isNamespaceEnabled(namespace: string): boolean {
  const {filter: debugFilter} = useDebugStore.getState()
  if (!debugFilter) return false

  // Split by comma for multiple patterns
  const patterns = debugFilter
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)

  return patterns.some((pattern) => {
    if (pattern === "*") return true
    if (pattern.endsWith(":*")) {
      const prefix = pattern.slice(0, -2)
      return namespace.startsWith(prefix)
    }
    return namespace === pattern
  })
}

/**
 * Add a log entry to the ring buffer
 */
export function addLog(
  namespace: string,
  level: "log" | "warn" | "error",
  message: string
): void {
  // Only capture logs if debugging is enabled for this namespace
  if (!isNamespaceEnabled(namespace)) {
    return
  }

  const entry: LogEntry = {
    timestamp: Date.now(),
    namespace,
    level,
    message,
  }

  // In worker context, send to main thread via BroadcastChannel
  if (typeof window === "undefined" && logChannel) {
    logChannel.postMessage(entry)
    return
  }

  // In main thread, add to local buffer
  logs.push(entry)
  if (logs.length > MAX_LOGS) {
    logs.shift()
  }

  notifySubscribers()
}

/**
 * Get all logs, optionally filtered by namespace or level
 */
export function getLogs(filters?: {
  namespace?: string
  level?: "log" | "warn" | "error"
  limit?: number
}): LogEntry[] {
  let result = [...logs]

  if (filters?.namespace) {
    const ns = filters.namespace
    result = result.filter((log) => {
      // Support glob patterns like "nostr:*"
      if (ns.endsWith(":*")) {
        const prefix = ns.slice(0, -2)
        return log.namespace.startsWith(prefix)
      }
      return log.namespace === ns
    })
  }

  if (filters?.level) {
    result = result.filter((log) => log.level === filters.level)
  }

  if (filters?.limit) {
    result = result.slice(-filters.limit)
  }

  return result
}

/**
 * Clear all logs
 */
export function clearLogs(): void {
  logs.length = 0
  notifySubscribers()
}

/**
 * Get unique namespaces currently captured
 */
export function getNamespaces(): string[] {
  const namespaces = new Set(logs.map((log) => log.namespace))
  return Array.from(namespaces).sort()
}

/**
 * Subscribe to log changes
 */
export function subscribeLogs(callback: () => void): () => void {
  subscribers.add(callback)
  return () => subscribers.delete(callback)
}

function notifySubscribers(): void {
  subscribers.forEach((cb) => cb())
}
