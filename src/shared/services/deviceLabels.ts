import {nip19} from "nostr-tools"

import {isMobileUA, isTauri} from "@/utils/utils"

export interface DeviceLabels {
  deviceLabel?: string
  clientLabel?: string
}

interface DeviceLabelReader {
  getDeviceLabels(identityPubkey: string): DeviceLabels | undefined
}

interface ManagedDeviceDisplay {
  title: string
  subtitle?: string
}

const normalizeLabel = (value?: string | null): string | undefined => {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

const titleCaseWords = (value: string): string => {
  return value.replace(/\b\w/g, (char) => char.toUpperCase())
}

const prettifyHostname = (value: string): string | undefined => {
  const normalized = normalizeLabel(value)?.replace(/[._-]+/g, " ")
  return normalized ? titleCaseWords(normalized) : undefined
}

const platformLabelFromUserAgent = (userAgent: string): string | undefined => {
  if (/iphone/i.test(userAgent)) return "iPhone"
  if (/ipad/i.test(userAgent)) return "iPad"
  if (/android/i.test(userAgent)) return "Android"
  if (/macintosh|mac os x/i.test(userAgent)) return "Mac"
  if (/windows/i.test(userAgent)) return "Windows"
  if (/linux/i.test(userAgent)) return "Linux"
  return undefined
}

const browserLabelFromUserAgent = (userAgent: string): string | undefined => {
  if (/edg\//i.test(userAgent)) return "Edge"
  if (/firefox|fxios/i.test(userAgent)) return "Firefox"
  if (/opr\/|opera/i.test(userAgent)) return "Opera"
  if (/chrome|crios/i.test(userAgent)) return "Chrome"
  if (/safari/i.test(userAgent)) return "Safari"
  return undefined
}

const desktopClientLabel = "Iris Client Desktop"
const mobileClientLabel = "Iris Client Mobile"
const webClientLabel = "Iris Client Web"

const formatManagedDevicePubkey = (devicePubkey: string): string => {
  if (devicePubkey.startsWith("npub")) {
    return devicePubkey
  }

  try {
    return nip19.npubEncode(devicePubkey)
  } catch {
    return devicePubkey
  }
}

export const inferBrowserDeviceLabel = (userAgent: string): string => {
  const browser = browserLabelFromUserAgent(userAgent)
  const platform = platformLabelFromUserAgent(userAgent)

  if (browser && platform) {
    return `${browser} on ${platform}`
  }

  return browser || platform || "Browser"
}

const platformFallbackDeviceLabel = (platformName?: string | null): string | undefined => {
  switch (platformName) {
    case "macos":
      return "Mac"
    case "windows":
      return "Windows PC"
    case "linux":
      return "Linux machine"
    case "android":
      return "Android device"
    case "ios":
      return "iPhone"
    default:
      return undefined
  }
}

const resolveClientLabel = async (): Promise<string> => {
  if (!isTauri()) {
    return isMobileUA() ? mobileClientLabel : webClientLabel
  }

  try {
    const {platform} = await import("@tauri-apps/plugin-os")
    const platformName = await platform()
    return platformName === "android" || platformName === "ios"
      ? mobileClientLabel
      : desktopClientLabel
  } catch {
    return desktopClientLabel
  }
}

const resolveTauriDeviceLabel = async (): Promise<string | undefined> => {
  if (!isTauri()) {
    return undefined
  }

  try {
    const {hostname, platform} = await import("@tauri-apps/plugin-os")
    const [host, platformName] = await Promise.all([
      hostname().catch(() => undefined),
      platform().catch(() => undefined),
    ])

    return prettifyHostname(host) || platformFallbackDeviceLabel(platformName)
  } catch {
    return undefined
  }
}

export const getCurrentDeviceRegistrationLabels = async (): Promise<DeviceLabels> => {
  const clientLabel = await resolveClientLabel()
  const deviceLabel =
    (await resolveTauriDeviceLabel()) ||
    inferBrowserDeviceLabel(typeof navigator === "undefined" ? "" : navigator.userAgent)

  return {
    deviceLabel,
    clientLabel,
  }
}

export const getLinkedDeviceRegistrationLabels = async (): Promise<DeviceLabels> => {
  return {
    deviceLabel: "Linked device",
    clientLabel: "Iris Client",
  }
}

export const getStoredManagedDeviceLabels = (
  identityPubkey: string,
  reader?: DeviceLabelReader
): DeviceLabels | undefined => {
  return reader?.getDeviceLabels(identityPubkey)
}

export const describeManagedDevice = (
  identityPubkey: string,
  labels?: DeviceLabels
): ManagedDeviceDisplay => {
  const fallback = formatManagedDevicePubkey(identityPubkey)
  const deviceLabel = normalizeLabel(labels?.deviceLabel)
  const clientLabel = normalizeLabel(labels?.clientLabel)

  if (deviceLabel) {
    return {
      title: deviceLabel,
      subtitle: clientLabel ? `${clientLabel} • ${fallback}` : fallback,
    }
  }

  if (clientLabel) {
    return {
      title: clientLabel,
      subtitle: fallback,
    }
  }

  return {title: fallback}
}
