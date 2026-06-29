import type {RouteMatchCallbackOptions} from "workbox-core"

const HASHTREE_BLOB_ORIGINS = new Set(["https://cdn.iris.to"])

const HASHTREE_BLOB_PATH_RE = /^\/[0-9a-f]{64}\.bin$/i

interface NotificationClickPayload {
  url?: unknown
  event?: {
    url?: unknown
  }
}

export function isHashtreeBlobRequest({
  request,
  url,
}: Pick<RouteMatchCallbackOptions, "request" | "url">): boolean {
  if (request.method !== "GET") {
    return false
  }

  if (!HASHTREE_BLOB_ORIGINS.has(url.origin)) {
    return false
  }

  return HASHTREE_BLOB_PATH_RE.test(url.pathname)
}

function getNotificationTargetUrl(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined
  }

  const payload = data as NotificationClickPayload
  if (typeof payload.url === "string" && payload.url.trim()) {
    return payload.url
  }

  if (typeof payload.event?.url === "string" && payload.event.url.trim()) {
    return payload.event.url
  }

  return undefined
}

export function resolveNotificationClickUrl(
  notificationData: unknown,
  appOrigin: string
): string {
  const origin = new URL(appOrigin).origin
  const fallbackUrl = `${origin}/`
  const rawUrl = getNotificationTargetUrl(notificationData)
  if (!rawUrl) {
    return fallbackUrl
  }

  try {
    const targetUrl = new URL(rawUrl, `${origin}/`)
    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
      return fallbackUrl
    }

    return `${origin}${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`
  } catch {
    return fallbackUrl
  }
}
