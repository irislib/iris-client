/* eslint-disable @typescript-eslint/no-explicit-any */
import debug from "debug"
import {addLog, initializeLogCollection} from "./logCollector"
import {useDebugStore} from "@/stores/debug"

export interface DebugLogger {
  log: (...args: any[]) => void
  warn: (...args: any[]) => void
  error: (...args: any[]) => void
}

/**
 * Create debug loggers for a given namespace
 * Usage: const {log, warn, error} = createDebugLogger('nostr:relay')
 */
export function createDebugLogger(namespace: string): DebugLogger {
  const log = debug(namespace)
  const warn = debug(`${namespace}:warn`)
  const err = debug(`${namespace}:error`)

  return {
    log: (...args: any[]) => {
      ;(log as any)(...args)
      // Early exit if logging is disabled - avoid formatArgs overhead
      if (!useDebugStore.getState().enabled) return
      try {
        addLog(namespace, "log", formatArgs(args))
      } catch {
        // Silently fail if logCollector not ready
      }
    },
    warn: (...args: any[]) => {
      ;(warn as any)(...args)
      if (!useDebugStore.getState().enabled) return
      try {
        addLog(namespace, "warn", formatArgs(args))
      } catch {
        // Silently fail if logCollector not ready
      }
    },
    error: (...args: any[]) => {
      ;(err as any)(...args)
      if (!useDebugStore.getState().enabled) return
      try {
        addLog(namespace, "error", formatArgs(args))
      } catch {
        // Silently fail if logCollector not ready
      }
    },
  }
}

function formatArgs(args: any[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg
      if (arg instanceof Error) return arg.message
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    })
    .join(" ")
}

/**
 * Initialize debug logging based on environment
 * Call this once on app startup
 */
export function initializeDebugLogging(): void {
  // Initialize log collector
  initializeLogCollection()

  // Debug logging is off by default. Enable via System Settings.
  // Users can set debug filter in System Settings > Log Viewer > Debug Namespace Filter
}
