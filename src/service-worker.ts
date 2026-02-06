/// <reference lib="webworker" />
import {
  INVITE_EVENT_KIND,
  INVITE_RESPONSE_KIND,
  MESSAGE_EVENT_KIND,
} from "nostr-double-ratchet/src"
import {PROFILE_AVATAR_WIDTH, EVENT_AVATAR_WIDTH} from "./shared/components/user/const"
import {CacheFirst, StaleWhileRevalidate, NetworkOnly} from "workbox-strategies"
import {CacheableResponsePlugin} from "workbox-cacheable-response"
import {precacheAndRoute, PrecacheEntry} from "workbox-precaching"
import {generateProxyUrl} from "./shared/utils/imgproxy"
import {ExpirationPlugin} from "workbox-expiration"
import {registerRoute} from "workbox-routing"
import {clientsClaim, RouteMatchCallbackOptions} from "workbox-core"
import {VerifiedEvent} from "nostr-tools"
import localforage from "localforage"
import {KIND_CHANNEL_CREATE} from "./utils/constants"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import NDKCacheAdapterDexie from "@/lib/ndk-cache"
import {createSessionStorage, tryDecryptDmPushEvent} from "@/utils/dmPushDecrypt"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

let cacheAdapter: NDKCacheAdapterDexie | null = null

function getCacheAdapter(): NDKCacheAdapterDexie {
  if (!cacheAdapter) {
    cacheAdapter = new NDKCacheAdapterDexie({
      dbName: "treelike-nostr",
      eventCacheSize: 5000,
    })
  }
  return cacheAdapter
}

// eslint-disable-next-line no-undef
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | PrecacheEntry)[]
}

precacheAndRoute(self.__WB_MANIFEST)
clientsClaim()

// Prevent caching of graph-api.iris.to requests
registerRoute(
  ({url}: RouteMatchCallbackOptions) => url.origin === "https://graph-api.iris.to",
  new NetworkOnly()
)

// Cache icons.svg for faster loading on mobile
registerRoute(
  ({url}: RouteMatchCallbackOptions) => url.pathname.endsWith("/icons.svg"),
  new StaleWhileRevalidate({
    cacheName: "icons-cache",
    plugins: [
      new ExpirationPlugin({maxEntries: 1, maxAgeSeconds: 7 * 24 * 60 * 60}), // 7 days
      new CacheableResponsePlugin({statuses: [0, 200]}),
    ],
  })
)

registerRoute(
  ({url}: RouteMatchCallbackOptions) => url.pathname.endsWith("/.well-known/nostr.json"),
  new StaleWhileRevalidate({
    cacheName: "nostr-json-cache",
    plugins: [new ExpirationPlugin({maxAgeSeconds: 4 * 60 * 60})],
  })
)

// Avatars
registerRoute(
  ({request, url}: RouteMatchCallbackOptions) => {
    return (
      request.destination === "image" &&
      url.href.startsWith("https://imgproxy.") &&
      (url.pathname.includes(
        `rs:fill:${PROFILE_AVATAR_WIDTH * 2}:${PROFILE_AVATAR_WIDTH * 2}`
      ) ||
        url.pathname.includes(
          `rs:fill:${EVENT_AVATAR_WIDTH * 2}:${EVENT_AVATAR_WIDTH * 2}`
        ))
    )
  },
  new CacheFirst({
    cacheName: "avatar-cache",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100, // gif avatars can still be large
        matchOptions: {
          ignoreVary: true,
        },
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  })
)

// Cache images from any domain with size limit
registerRoute(
  // match images except gif
  ({request, url}: RouteMatchCallbackOptions) =>
    request.destination === "image" && !url.pathname.endsWith(".gif"),
  new CacheFirst({
    cacheName: "image-cache",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        matchOptions: {
          ignoreVary: true,
        },
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  })
)

registerRoute(
  ({url}: RouteMatchCallbackOptions) =>
    url.origin === "https://nostr.api.v0l.io" &&
    url.pathname.startsWith("/api/v1/preview"),
  new CacheFirst({
    cacheName: "preview-cache",
    plugins: [
      new ExpirationPlugin({maxAgeSeconds: 24 * 60 * 60}),
      new CacheableResponsePlugin({statuses: [0, 200]}),
    ],
  })
)

registerRoute(
  ({url}: RouteMatchCallbackOptions) =>
    url.origin === "https://api.snort.social" &&
    url.pathname.startsWith("/api/v1/translate"),
  new CacheFirst({
    cacheName: "translate-cache",
    plugins: [
      new ExpirationPlugin({maxEntries: 1000}),
      new CacheableResponsePlugin({
        statuses: [0, 200, 204],
      }),
    ],
  })
)

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting()
  }
})
self.addEventListener("install", (event) => {
  // delete all cache on install
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          log("Deleting cache: ", cacheName)
          return caches.delete(cacheName)
        })
      )
    })
  )
})

interface PushData {
  event: {
    id: string
    pubkey: string
    created_at: number
    kind: number
    tags: string[][]
    content: string
    sig: string
  }
  title: string
  body: string
  icon: string
  url: string
}

self.addEventListener("notificationclick", (event) => {
  const notificationData = event.notification.data
  event.notification.close()
  log("Notification clicked:", notificationData)

  event.waitUntil(
    (async function () {
      // Handle both direct URL and nested event data structure
      const path = notificationData?.url || notificationData?.event?.url
      if (!path) {
        log("No URL in notification data")
        return
      }

      // If it's already a full URL, use URL constructor, otherwise just use the path
      const pathname = path.startsWith("http") ? new URL(path).pathname : path
      const fullUrl = `${self.location.origin}${pathname}`
      log("Navigating to:", fullUrl)

      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      log("Found clients:", allClients.length)

      if (allClients.length > 0) {
        // Try to find a visible client first, otherwise use the first one
        let client = allClients.find((c) => c.visibilityState === "visible")
        if (!client) {
          client = allClients[0]
        }

        try {
          await client.focus()
          log("Client focused, sending navigation message")
          // Add a small delay to ensure focus completes before navigation
          await new Promise((resolve) => setTimeout(resolve, 100))
          await client.postMessage({
            type: "NAVIGATE_REACT_ROUTER",
            url: fullUrl,
          })
          log("Navigation message sent successfully")
          return
        } catch (err) {
          error("Failed to focus client or send navigation message:", err)
          // Fall through to opening new window
        }
      }

      log("No clients found or client communication failed, opening new window")
      if (self.clients.openWindow) {
        try {
          const newClient = await self.clients.openWindow(fullUrl)
          log("New window opened successfully")
          return newClient
        } catch (err) {
          error("Failed to open new window:", err)
        }
      } else {
        error("openWindow not available")
      }
    })()
  )
})

const NOTIFICATION_CONFIGS: Record<
  number,
  {
    title: string | ((displayName?: string) => string)
    url: string
    icon: string
  }
> = {
  [MESSAGE_EVENT_KIND]: {
    title: (displayName?: string) =>
      displayName ? `New private message from ${displayName}` : "New private message",
    url: "/chats",
    icon: "/favicon.png",
  },
  [INVITE_EVENT_KIND]: {
    title: "New message request",
    url: "/chats",
    icon: "/favicon.png",
  },
  [INVITE_RESPONSE_KIND]: {
    title: "New private message",
    url: "/chats",
    icon: "/favicon.png",
  },
} as const

const SESSION_STORAGE = createSessionStorage()

async function getDisplayName(pubkey: string): Promise<string> {
  try {
    const adapter = getCacheAdapter()
    const profile = await adapter.fetchProfile(pubkey)
    if (!profile) return pubkey
    return profile.name || profile.displayName || pubkey
  } catch (err) {
    error("Failed to fetch profile from cache:", err)
    return pubkey
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      // Check if we should show notification based on page visibility
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      const isPageVisible = clients.some((client) => client.visibilityState === "visible")
      if (isPageVisible) {
        log("Page is visible, ignoring web push")
        return
      }

      const data = event.data?.json() as PushData | undefined
      if (!data?.event) return

      if (data.event.kind === MESSAGE_EVENT_KIND) {
        const result = await tryDecryptDmPushEvent(
          data.event as unknown as VerifiedEvent,
          {
            storage: SESSION_STORAGE,
            timeoutMs: 500,
          }
        )
        if (result.success) {
          if (result.silent) return
          if (result.kind === KIND_CHANNEL_CREATE) {
            const config = NOTIFICATION_CONFIGS[MESSAGE_EVENT_KIND]
            await self.registration.showNotification("New group invite", {
              icon: config.icon,
              data: {
                url: config.url,
                event: data.event,
              },
            })
          } else {
            const displayName = await getDisplayName(result.userPublicKey)
            const config = NOTIFICATION_CONFIGS[MESSAGE_EVENT_KIND]
            const title =
              typeof config.title === "function"
                ? config.title(displayName)
                : config.title
            await self.registration.showNotification(title, {
              body: result.content,
              icon: config.icon,
              data: {
                url: config.url,
                event: data.event,
              },
            })
          }
          return
        }
      }

      if (NOTIFICATION_CONFIGS[data.event.kind]) {
        const config = NOTIFICATION_CONFIGS[data.event.kind]
        const title = typeof config.title === "function" ? config.title() : config.title
        await self.registration.showNotification(title, {
          icon: config.icon,
          data: {url: config.url, event: data.event},
        })
        return
      }

      const imgproxySettings = (await localforage.getItem("imgproxy-settings")) as {
        url: string
        key: string
        salt: string
        enabled: boolean
        fallbackToOriginal: boolean
      } | null
      const proxyConfig = imgproxySettings
        ? {
            url: imgproxySettings.url,
            key: imgproxySettings.key,
            salt: imgproxySettings.salt,
          }
        : undefined

      const icon = data.icon?.startsWith("http")
        ? generateProxyUrl(data.icon, {width: 128, square: true}, proxyConfig)
        : data.icon || "/favicon.png"

      await self.registration.showNotification(data.title || "New notification", {
        body: data.body,
        icon,
        data,
      })
    })()
  )
})
