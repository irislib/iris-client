import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

export const MOBILE_BREAKPOINT = 768

export const isMobileUA = (): boolean => {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

export const isAboveMobileBreakpoint = (): boolean => {
  return typeof window !== "undefined" && window.innerWidth >= MOBILE_BREAKPOINT
}

const isShareableProtocol = (protocol: string): boolean =>
  protocol === "http:" || protocol === "https:"

const isLoopbackLikeHost = (hostname: string): boolean =>
  hostname === "127.0.0.1" ||
  hostname === "localhost" ||
  hostname.endsWith(".htree.localhost")

export const getShareableAppOrigin = (): string => {
  if (typeof window === "undefined") {
    return "https://iris.to"
  }

  const protocol = window.location.protocol?.toLowerCase() || ""
  const hostname = window.location.hostname?.toLowerCase() || ""

  if (isShareableProtocol(protocol) && !isLoopbackLikeHost(hostname)) {
    return window.location.origin
  }

  return "https://iris.to"
}

export const openExternalLink = async (url: string) => {
  log("Opening external URL:", url)
  window.open(url, "_blank")
}

export const confirm = async (message: string, title?: string): Promise<boolean> => {
  return window.confirm(title ? `${title}\n\n${message}` : message)
}

export const alert = async (message: string, title?: string): Promise<void> => {
  window.alert(title ? `${title}\n\n${message}` : message)
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
