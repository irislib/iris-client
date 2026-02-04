import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

export const MOBILE_BREAKPOINT = 768

export const isTauri = () =>
  typeof window !== "undefined" && !!(window.__TAURI__ || window.__TAURI_INTERNALS__)

export const isMobileTauri = async (): Promise<boolean> => {
  if (!isTauri()) return false
  try {
    const {platform} = await import("@tauri-apps/plugin-os")
    const platformType = await platform()
    return platformType === "android" || platformType === "ios"
  } catch {
    return false
  }
}

export const isMobileUA = (): boolean => {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

export const isAboveMobileBreakpoint = (): boolean => {
  return typeof window !== "undefined" && window.innerWidth >= MOBILE_BREAKPOINT
}

export const openExternalLink = async (url: string) => {
  if (isTauri()) {
    try {
      const {openUrl} = await import("@tauri-apps/plugin-opener")
      log("Opening external URL in Tauri:", url)
      await openUrl(url)
      log("Successfully opened URL")
    } catch (err) {
      error("Failed to open URL in Tauri:", err)
      // Fallback to window.open
      window.open(url, "_blank")
    }
  } else {
    window.open(url, "_blank")
  }
}

export const confirm = async (message: string, title?: string): Promise<boolean> => {
  if (isTauri()) {
    try {
      const {confirm: tauriConfirm} = await import("@tauri-apps/plugin-dialog")
      return await tauriConfirm(message, {title, kind: "warning"})
    } catch (err) {
      error("Failed to show Tauri confirm dialog:", err)
      return window.confirm(title ? `${title}\n\n${message}` : message)
    }
  }
  return window.confirm(title ? `${title}\n\n${message}` : message)
}

export const alert = async (message: string, title?: string): Promise<void> => {
  if (isTauri()) {
    try {
      const {message: tauriMessage} = await import("@tauri-apps/plugin-dialog")
      await tauriMessage(message, {title, kind: "info"})
    } catch (err) {
      error("Failed to show Tauri alert dialog:", err)
      window.alert(title ? `${title}\n\n${message}` : message)
    }
  } else {
    window.alert(title ? `${title}\n\n${message}` : message)
  }
}

export const formatAmount = (n: number, maxSignificantDigits = 4) => {
  if (n < 1000) return n.toString()

  let value: number
  let suffix: string

  if (n < 1000000) {
    value = n / 1000
    suffix = "K"
  } else {
    value = n / 1000000
    suffix = "M"
  }

  // Round to max significant digits
  const rounded = Number(value.toPrecision(Math.min(maxSignificantDigits, 4)))

  // Format with appropriate decimal places
  let formatted: string
  if (rounded >= 100) {
    formatted = Math.round(rounded).toString()
  } else if (rounded >= 10) {
    formatted = rounded.toFixed(1).replace(/\.0$/, "")
  } else {
    formatted = rounded.toFixed(2).replace(/\.00$/, "")
  }

  return formatted + suffix
}

export const truncateMiddle = (str: string, startChars = 12, endChars = 12) => {
  if (str.length <= startChars + endChars) return str
  return `${str.slice(0, startChars)}...${str.slice(-endChars)}`
}

export function formatDayLabel(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round(
    (today.getTime() - messageDay.getTime()) / (1000 * 60 * 60 * 24)
  )

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return date.toLocaleDateString(undefined, {weekday: "long"})

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  })
}
