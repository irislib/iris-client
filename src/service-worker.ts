/// <reference lib="webworker" />
import {
  INVITE_EVENT_KIND,
  INVITE_RESPONSE_KIND,
  MESSAGE_EVENT_KIND,
  deserializeSessionState,
  Session,
  Rumor,
} from "nostr-double-ratchet/src"
import {PROFILE_AVATAR_WIDTH, EVENT_AVATAR_WIDTH} from "./shared/components/user/const"
import {CacheFirst, StaleWhileRevalidate, NetworkOnly} from "workbox-strategies"
import {CacheableResponsePlugin} from "workbox-cacheable-response"
import {precacheAndRoute, PrecacheEntry} from "workbox-precaching"
import {generateProxyUrl} from "./shared/utils/imgproxy"
import {ExpirationPlugin} from "workbox-expiration"
import {registerRoute} from "workbox-routing"
import {clientsClaim} from "workbox-core"
import {VerifiedEvent} from "nostr-tools"
import localforage from "localforage"
import {KIND_CHANNEL_CREATE} from "./utils/constants"

// eslint-disable-next-line no-undef
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | PrecacheEntry)[]
}

precacheAndRoute(self.__WB_MANIFEST)
clientsClaim()

// Prevent caching of graph-api.iris.to requests
registerRoute(({url}) => url.origin === "https://graph-api.iris.to", new NetworkOnly())

// Cache icons.svg for faster loading on mobile
registerRoute(
  ({url}) => url.pathname.endsWith("/icons.svg"),
  new StaleWhileRevalidate({
    cacheName: "icons-cache",
    plugins: [
      new ExpirationPlugin({maxEntries: 1, maxAgeSeconds: 7 * 24 * 60 * 60}), // 7 days
      new CacheableResponsePlugin({statuses: [0, 200]}),
    ],
  })
)

registerRoute(
  ({url}) => url.pathname.endsWith("/.well-known/nostr.json"),
  new StaleWhileRevalidate({
    cacheName: "nostr-json-cache",
    plugins: [new ExpirationPlugin({maxAgeSeconds: 4 * 60 * 60})],
  })
)

// Avatars
registerRoute(
  ({request, url}) => {
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
  ({request, url}) => request.destination === "image" && !url.pathname.endsWith(".gif"),
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
  ({url}) =>
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
  ({url}) =>
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
          console.debug("Deleting cache: ", cacheName)
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
  console.debug("Notification clicked:", notificationData)

  event.waitUntil(
    (async function () {
      // Handle both direct URL and nested event data structure
      const path = notificationData?.url || notificationData?.event?.url
      if (!path) {
        console.debug("No URL in notification data")
        return
      }

      // If it's already a full URL, use URL constructor, otherwise just use the path
      const pathname = path.startsWith("http") ? new URL(path).pathname : path
      const fullUrl = `${self.location.origin}${pathname}`
      console.debug("Navigating to:", fullUrl)

      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      console.debug("Found clients:", allClients.length)

      if (allClients.length > 0) {
        // Try to find a visible client first, otherwise use the first one
        let client = allClients.find((c) => c.visibilityState === "visible")
        if (!client) {
          client = allClients[0]
        }

        try {
          await client.focus()
          console.debug("Client focused, sending navigation message")
          // Add a small delay to ensure focus completes before navigation
          await new Promise((resolve) => setTimeout(resolve, 100))
          await client.postMessage({
            type: "NAVIGATE_REACT_ROUTER",
            url: fullUrl,
          })
          console.debug("Navigation message sent successfully")
          return
        } catch (error) {
          console.error("Failed to focus client or send navigation message:", error)
          // Fall through to opening new window
        }
      }

      console.debug("No clients found or client communication failed, opening new window")
      if (self.clients.openWindow) {
        try {
          const newClient = await self.clients.openWindow(fullUrl)
          console.debug("New window opened successfully")
          return newClient
        } catch (error) {
          console.error("Failed to open new window:", error)
        }
      } else {
        console.error("openWindow not available")
      }
    })()
  )
})

const NOTIFICATION_CONFIGS: Record<
  number,
  {
    title: string
    url: string
    icon: string
  }
> = {
  [MESSAGE_EVENT_KIND]: {
    title: "New private message",
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

type DecryptResult =
  | {
      success: false
    }
  | {
      success: true
      kind: number
      content: string
      sessionId: string
    }

const SESSION_STORAGE = localforage.createInstance({
  name: "iris-session-manager",
  storeName: "session-private",
})

const SESSION_STORAGE_PREFIX = "private"
const USER_RECORD_PREFIX = "v1/user/"

type StoredSessionEntry = string

interface StoredDeviceRecord {
  deviceId: string
  activeSession: StoredSessionEntry | null
  inactiveSessions: StoredSessionEntry[]
  staleAt?: number
}

interface StoredUserRecord {
  publicKey: string
  devices: StoredDeviceRecord[]
}

interface StoredSessionState {
  sessionId: string
  serializedState: StoredSessionEntry
}

const fetchStoredSessions = async (): Promise<StoredSessionState[]> => {
  console.warn("DM decrypt: loading stored sessions from localforage")
  try {
    const keys = await SESSION_STORAGE.keys()
    const userRecordKeys = keys.filter((key) =>
      key.startsWith(`${SESSION_STORAGE_PREFIX}${USER_RECORD_PREFIX}`)
    )

    const sessions: StoredSessionState[] = []

    for (const key of userRecordKeys) {
      const record = await SESSION_STORAGE.getItem<StoredUserRecord>(key)
      if (!record?.devices?.length) continue

      for (const device of record.devices) {
        if (device.staleAt !== undefined) continue
        if (device.activeSession) {
          sessions.push({sessionId: record.publicKey, serializedState: device.activeSession})
        }
        for (const serialized of device.inactiveSessions) {
          sessions.push({sessionId: record.publicKey, serializedState: serialized})
        }
      }
    }

    console.warn("DM decrypt: sessions prepared", {
      userRecords: userRecordKeys.length,
      sessionCount: sessions.length,
    })
    return sessions
  } catch (error) {
    console.error("Failed to load stored sessions:", error)
    return []
  }
}

const tryDecryptPrivateDM = async (data: PushData): Promise<DecryptResult> => {
  try {
    const sessionEntries = await fetchStoredSessions()
    if (!sessionEntries.length) {
      console.warn("DM decrypt: no stored sessions available")
    }

    for (const {sessionId, serializedState} of sessionEntries) {
      let state
      try {
        state = deserializeSessionState(serializedState)
      } catch (error) {
        console.error("Failed to deserialize session state:", error)
        continue
      }

      const foundMatchingPubKey =
        state.theirCurrentNostrPublicKey === data.event.pubkey ||
        state.theirNextNostrPublicKey === data.event.pubkey

      if (!foundMatchingPubKey) {
        console.warn("DM decrypt: no pubkey match for session", {
          sessionId,
          theirCurrent: state.theirCurrentNostrPublicKey,
          theirNext: state.theirNextNostrPublicKey,
          eventPubkey: data.event.pubkey,
        })
        continue
      }

      console.warn("DM decrypt: found matching session", {
        sessionId,
        eventPubkey: data.event.pubkey,
      })

      const headerTag = data.event.tags.find(([key]) => key === "header")
      console.warn("DM decrypt: delivering event to session", {
        sessionId,
        hasHeaderTag: Boolean(headerTag?.[1]),
        headerLength: headerTag?.[1]?.length ?? 0,
        eventId: data.event.id,
      })

      const eventForSession: VerifiedEvent = {
        ...data.event,
        tags: data.event.tags.filter(([key]) => key === "header"),
      }

      const session = new Session((_, onEvent) => {
        onEvent(eventForSession)
        return () => {}
      }, state)

      let unsubscribe: (() => void) | undefined
      const innerEvent = await new Promise<Rumor | null>((resolve) => {
        console.warn("DM decrypt: waiting for session to emit decrypted rumor", {
          sessionId,
          eventId: data.event.id,
        })
        const timeout = setTimeout(() => {
          console.warn("DM decrypt: timed out waiting for decrypted rumor", {
            sessionId,
            eventId: data.event.id,
          })
          resolve(null)
        }, 1500)
        unsubscribe = session.onEvent((event) => {
          console.warn("DM decrypt: session emitted rumor", {
            sessionId,
            kind: event.kind,
            hasContent: Boolean(event.content),
          })
          clearTimeout(timeout)
          resolve(event)
        })
      })

      unsubscribe?.()

      console.warn("DM decrypt: session processing complete", {
        sessionId,
        result: innerEvent ? "success" : "null",
      })

      return innerEvent === null
        ? {
            success: false,
          }
        : {
            success: true,
            kind: innerEvent.kind,
            content: innerEvent.content,
            sessionId,
          }
    }

    console.warn("DM decrypt: exhausted stored sessions without finding a match")
  } catch (err) {
    console.error("DM decryption failed:", err)
  }
  return {
    success: false,
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      // Check if we should show notification based on page visibility
      // const clients = await self.clients.matchAll({
      //   type: "window",
      //   includeUncontrolled: true,
      // })
      // const isPageVisible = clients.some((client) => client.visibilityState === "visible")
      // if (isPageVisible) {
      //   console.debug("Page is visible, ignoring web push")
      //   return
      // }

      const data = event.data?.json() as PushData | undefined
      if (!data?.event) return

      console.warn("Service worker received push event", {
        kind: data.event.kind,
        id: data.event.id,
        pubkey: data.event.pubkey,
      })

      if (data.event.kind === MESSAGE_EVENT_KIND) {
        const result = await tryDecryptPrivateDM(data)
        if (result.success) {
          console.warn("DM decrypt: notification will use decrypted content", {
            kind: result.kind,
            sessionId: result.sessionId,
          })
          if (result.kind === KIND_CHANNEL_CREATE) {
            await self.registration.showNotification("New group invite", {
              icon: NOTIFICATION_CONFIGS[MESSAGE_EVENT_KIND].icon,
              data: {
                url: `/chats/${encodeURIComponent(result.sessionId)}`,
                event: data.event,
              },
            })
          } else {
            await self.registration.showNotification(
              NOTIFICATION_CONFIGS[MESSAGE_EVENT_KIND].title,
              {
                body: result.content,
                icon: NOTIFICATION_CONFIGS[MESSAGE_EVENT_KIND].icon,
                data: {
                  url: `/chats/${encodeURIComponent(result.sessionId)}`,
                  event: data.event,
                },
              }
            )
          }
          return
        }

        const headerTag = data.event.tags.find(([key]) => key === "header")
        console.warn("DM decrypt: failed to decrypt, falling back to generic notification", {
          eventId: data.event.id,
          pubkey: data.event.pubkey,
          hasHeaderTag: Boolean(headerTag?.[1]),
        })
      }

      if (NOTIFICATION_CONFIGS[data.event.kind]) {
        const config = NOTIFICATION_CONFIGS[data.event.kind]
        console.warn("Showing notification via NOTIFICATION_CONFIGS", {
          kind: data.event.kind,
          title: config.title,
        })
        await self.registration.showNotification(config.title, {
          icon: config.icon,
          data: {url: config.url, event: data.event},
        })
        return
      }

      console.warn("Showing notification via data payload", {
        title: data.title,
        kind: data.event.kind,
      })

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
