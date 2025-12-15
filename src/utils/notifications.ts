import {INVITE_RESPONSE_KIND, MESSAGE_EVENT_KIND, SessionManager} from "nostr-double-ratchet/src"
import {useSettingsStore} from "@/stores/settings"
import {SortedMap} from "./SortedMap/SortedMap"
import {useUserStore} from "@/stores/user"
import {getSessionManager} from "@/shared/services/PrivateChats"
import {NDKTag, NDKEvent} from "@/lib/ndk"
import debounce from "lodash/debounce"
import {base64} from "@scure/base"
import IrisAPI from "./IrisAPI"
import {
  KIND_TEXT_NOTE,
  KIND_REPOST,
  KIND_REACTION,
  KIND_ZAP_RECEIPT,
  DEBUG_NAMESPACES,
} from "@/utils/constants"
import {createDebugLogger} from "@/utils/createDebugLogger"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

interface ReactedTime {
  time: number
  content?: string
  eventId?: string
}

export interface NotificationEvent {
  event: NDKEvent
  user: string // pubkey of the user (author or zapper)
  time: number
  content?: string
}

export interface Notification {
  id: string
  originalEventId: string
  users: SortedMap<string, ReactedTime> // Keep for backward compat, will migrate
  events: NotificationEvent[] // New: store full events
  kind: number
  time: number
  content: string
  tags?: NDKTag[]
}

export const notifications = new SortedMap<string, Notification>([], "time")

// Define the NotificationOptions interface locally
interface NotificationOptions {
  body?: string
  icon?: string
  image?: string
  badge?: string
  tag?: string
  data?: unknown
  vibrate?: number[]
  renotify?: boolean
  silent?: boolean
  requireInteraction?: boolean
  actions?: NotificationAction[]
  dir?: "auto" | "ltr" | "rtl"
  lang?: string
  timestamp?: number
  noscreen?: boolean
  sound?: string
}

// Define the NotificationAction interface locally
interface NotificationAction {
  action: string
  title: string
  icon?: string
}

export const showNotification = async (
  title: string,
  options?: NotificationOptions,
  nag = false
) => {
  if (!("serviceWorker" in navigator)) {
    if (nag) {
      const {alert} = await import("@/utils/utils")
      await alert(
        "Your browser doesn't support service workers, which are required for notifications."
      )
    }
    return
  }

  if (window.Notification?.permission === "granted") {
    navigator.serviceWorker.ready.then(async function (serviceWorker) {
      await serviceWorker.showNotification(title, options)
    })
  } else if (nag) {
    const {alert} = await import("@/utils/utils")
    await alert("Notifications are not allowed. Please enable them first.")
  }
}

let subscriptionPromise: Promise<PushSubscription | null> | null = null

async function getOrCreatePushSubscription() {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    return null
  }

  if (Notification.permission !== "granted") {
    return null
  }

  if (!subscriptionPromise) {
    subscriptionPromise = (async () => {
      const reg = await navigator.serviceWorker.ready
      let pushSubscription = await reg.pushManager.getSubscription()
      const store = useSettingsStore.getState()
      const api = new IrisAPI(store.notifications.server)
      const {vapid_public_key: vapidKey} = await api.getPushNotificationInfo()

      // Check if we need to resubscribe due to different vapid key
      if (pushSubscription) {
        const currentKey = pushSubscription.options.applicationServerKey
        // Add padding if needed and decode the VAPID key
        const paddedVapidKey = vapidKey.padEnd(Math.ceil(vapidKey.length / 4) * 4, "=")
        const vapidKeyArray = base64.decode(
          paddedVapidKey.replace(/-/g, "+").replace(/_/g, "/")
        )

        if (currentKey && !arrayBufferEqual(currentKey, vapidKeyArray)) {
          await pushSubscription.unsubscribe()
          pushSubscription = null
        }
      }

      if (!pushSubscription) {
        try {
          pushSubscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKey,
          })
        } catch (err) {
          error("Failed to subscribe to push notifications:", err)
          return null
        }
      }

      return pushSubscription
    })()
  }

  return subscriptionPromise
}

export const subscribeToDMNotifications = debounce(async () => {
  const pushSubscription = await getOrCreatePushSubscription()
  if (!pushSubscription) {
    return
  }

  const {publicKey} = useUserStore.getState()
  if (!publicKey) {
    return
  }

  let inviteRecipients: string[] = []

  let sessionAuthors: string[] = []
  try {
    const sessionManager = getSessionManager()
    await sessionManager.init()
    const userRecords = sessionManager.getUserRecords()
    sessionAuthors = extractSessionPubkeysFromUserRecords(userRecords, publicKey)
    const inviteRecipient = sessionManager.getDeviceInviteEphemeralKey()
    if (inviteRecipient) {
      inviteRecipients = [inviteRecipient]
    }
  } catch (err) {
    error("Failed to load session data for DM push subscription:", err)
  }

  const webPushData = {
    endpoint: pushSubscription.endpoint,
    p256dh: base64.encode(new Uint8Array(pushSubscription.getKey("p256dh")!)),
    auth: base64.encode(new Uint8Array(pushSubscription.getKey("auth")!)),
  }

  const messageFilter = {
    kinds: [MESSAGE_EVENT_KIND],
    authors: sessionAuthors,
  }

  const inviteFilter = {
    kinds: [INVITE_RESPONSE_KIND],
    "#p": inviteRecipients,
  }

  const store = useSettingsStore.getState()
  const api = new IrisAPI(store.notifications.server)
  const currentSubscriptions = await api.getNotificationSubscriptions()

  // Create/update subscription for session authors
  if (sessionAuthors.length > 0) {
    const sessionSub = Object.entries(currentSubscriptions).find(
      ([, sub]) =>
        sub.filter.kinds?.length === messageFilter.kinds.length &&
        sub.filter.kinds[0] === MESSAGE_EVENT_KIND &&
        sub.filter.authors && // Look for subscription with authors filter
        (sub.web_push_subscriptions || []).some(
          (sub) => sub.endpoint === webPushData.endpoint
        )
    )

    if (sessionSub) {
      const [id, sub] = sessionSub
      const existingAuthors = sub.filter.authors || []
      if (!arrayEqual(existingAuthors, sessionAuthors)) {
        await api.updateNotificationSubscription(id, {
          filter: messageFilter,
          web_push_subscriptions: [webPushData],
          webhooks: [],
          subscriber: sub.subscriber,
        })
      }
    } else {
      await api.registerPushNotifications([webPushData], messageFilter)
    }
  }

  // Create/update subscription for invite authors
  if (inviteRecipients.length > 0) {
    const inviteSub = Object.entries(currentSubscriptions).find(
      ([, sub]) =>
        sub.filter.kinds?.length === inviteFilter.kinds.length &&
        sub.filter.kinds[0] === INVITE_RESPONSE_KIND &&
        sub.filter["#p"] && // Look for subscription with #p tags
        !sub.filter.authors && // but no authors filter
        (sub.web_push_subscriptions || []).some(
          (sub) => sub.endpoint === webPushData.endpoint
        )
    )

    if (inviteSub) {
      const [id, sub] = inviteSub
      const existinginviteRecipients = sub.filter["#p"] || []
      if (!arrayEqual(existinginviteRecipients, inviteRecipients)) {
        await api.updateNotificationSubscription(id, {
          filter: inviteFilter,
          web_push_subscriptions: [webPushData],
          webhooks: [],
          subscriber: sub.subscriber,
        })
      }
    } else {
      await api.registerPushNotifications([webPushData], inviteFilter)
    }
  }
}, 5000)

// Helper function to compare arrays
function arrayEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((val, idx) => b[idx] === val)
}

type SessionUserRecords = ReturnType<SessionManager["getUserRecords"]>

function extractSessionPubkeysFromUserRecords(
  userRecords: SessionUserRecords,
  ourPublicKey?: string
): string[] {
  return Array.from(userRecords.entries())
    .filter(([publicKey]) => !ourPublicKey || publicKey !== ourPublicKey)
    .flatMap(([, {devices}]) =>
      Array.from(devices.values())
        .filter(({staleAt}) => staleAt === undefined)
        .flatMap(({activeSession, inactiveSessions = []}) => [
          activeSession,
          ...inactiveSessions,
        ])
        .filter(Boolean)
    )
    .flatMap((session) => {
      const state = session?.state
      if (!state) return []
      return [state.theirCurrentNostrPublicKey, state.theirNextNostrPublicKey]
    })
    .filter((key): key is string => typeof key === "string")
}

export const subscribeToNotifications = debounce(async () => {
  if (!("serviceWorker" in navigator)) {
    return
  }

  const myPubKey = useUserStore.getState().publicKey

  if (!myPubKey) {
    return
  }

  try {
    const pushSubscription = await getOrCreatePushSubscription()
    if (!pushSubscription) {
      return
    }

    const store = useSettingsStore.getState()
    const api = new IrisAPI(store.notifications.server)

    // Build notification filter based on user preferences
    const prefs = store.notifications.preferences || {
      mentions: true,
      replies: true,
      reposts: true,
      reactions: true,
      zaps: true,
      dms: true,
    }
    const kinds: number[] = []

    if (prefs.mentions || prefs.replies) {
      kinds.push(KIND_TEXT_NOTE)
    }
    if (prefs.reposts) {
      kinds.push(KIND_REPOST)
    }
    if (prefs.reactions) {
      kinds.push(KIND_REACTION)
    }
    if (prefs.zaps) {
      kinds.push(KIND_ZAP_RECEIPT)
    }

    if (kinds.length === 0) {
      log("No notification types enabled, skipping subscription")
      return
    }

    const notificationFilter = {
      "#p": [myPubKey],
      kinds,
    }

    // Check for existing subscription on notification server
    const currentSubscriptions = await api.getNotificationSubscriptions()

    // Find and delete any existing subscription with kinds [1,6,7]. remove at some point
    const oldSub = Object.entries(currentSubscriptions).find(
      ([, sub]) =>
        sub.filter["#p"]?.includes(myPubKey) &&
        sub.filter.kinds?.length === 3 &&
        sub.filter.kinds.includes(1) &&
        sub.filter.kinds.includes(6) &&
        sub.filter.kinds.includes(7) &&
        (sub.web_push_subscriptions || []).some(
          (s) => s.endpoint === pushSubscription.endpoint
        )
    )

    if (oldSub) {
      await api.deleteNotificationSubscription(oldSub[0])
    }

    // Check for existing subscription with new filter
    const existingSub = Object.entries(currentSubscriptions).find(
      ([, sub]) =>
        sub.filter["#p"]?.includes(myPubKey) &&
        sub.filter.kinds?.length === notificationFilter.kinds.length &&
        sub.filter.kinds.every((k) => notificationFilter.kinds.includes(k)) &&
        (sub.web_push_subscriptions || []).some(
          (s) => s.endpoint === pushSubscription.endpoint
        )
    )

    // If no matching subscription exists, create new one
    if (!existingSub) {
      await api.registerPushNotifications(
        [
          {
            endpoint: pushSubscription.endpoint,
            p256dh: base64.encode(new Uint8Array(pushSubscription.getKey("p256dh")!)),
            auth: base64.encode(new Uint8Array(pushSubscription.getKey("auth")!)),
          },
        ],
        notificationFilter
      )
    }
  } catch (e) {
    error(e)
  }
}, 5000)

export const clearNotifications = async () => {
  if (!("serviceWorker" in navigator)) {
    return
  }

  const registrations = await navigator.serviceWorker.getRegistrations()
  for (const registration of registrations) {
    const notifications = await registration.getNotifications()
    notifications.forEach((notification) => notification.close())
  }
}

export const unsubscribeAll = async () => {
  if (!("serviceWorker" in navigator)) {
    return
  }

  const reg = await navigator.serviceWorker.ready
  const pushSubscription = await reg.pushManager.getSubscription()

  if (!pushSubscription) {
    return
  }

  const store = useSettingsStore.getState()
  const api = new IrisAPI(store.notifications.server)
  const currentSubscriptions = await api.getNotificationSubscriptions()

  // Delete all matching subscriptions simultaneously
  const deletePromises = Object.entries(currentSubscriptions)
    .filter(([, sub]) =>
      (sub.web_push_subscriptions || []).some(
        (s) => s.endpoint === pushSubscription.endpoint
      )
    )
    .map(([id]) => api.deleteNotificationSubscription(id))

  await Promise.all(deletePromises)

  // Unsubscribe from push notifications at the browser level
  await pushSubscription.unsubscribe()
}

// Add this helper function at the bottom of the file
function arrayBufferEqual(a: ArrayBuffer, b: Uint8Array): boolean {
  const view1 = new Uint8Array(a)
  return view1.length === b.length && view1.every((val, i) => val === b[i])
}
