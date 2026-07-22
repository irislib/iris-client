import {MESSAGE_EVENT_KIND, type SessionUserRecordsLike} from "nostr-double-ratchet"
import {useSettingsStore} from "@/stores/settings"
import {SortedMap} from "./SortedMap/SortedMap"
import {useUserStore} from "@/stores/user"
import {getNdrRuntime} from "@/shared/services/PrivateChats"
import {NDKTag, NDKEvent} from "@/lib/ndk"
import debounce from "lodash/debounce"
import {base64} from "@scure/base"
import IrisAPI, {NotificationSubscription, PushNotifications} from "./IrisAPI"
import {
  KIND_TEXT_NOTE,
  KIND_REPOST,
  KIND_REACTION,
  KIND_ZAP_RECEIPT,
  DEBUG_NAMESPACES,
} from "@/utils/constants"
import {createDebugLogger} from "@/utils/createDebugLogger"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)
const MANAGED_NOTIFICATION_KINDS = [
  KIND_TEXT_NOTE,
  KIND_REPOST,
  KIND_REACTION,
  KIND_ZAP_RECEIPT,
]

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

/**
 * Runs one synchronization at a time and collapses queued work to the newest value.
 * A newer reconciliation therefore always observes the server state left by an older
 * in-flight mutation and gets the final say.
 */
export function createLatestNotificationSyncQueue<T>(
  sync: (value: T) => Promise<void>,
  onError: (reason: unknown) => void = error
) {
  let queuedValue: T
  let hasQueuedValue = false
  let drainPromise: Promise<void> | undefined

  const drain = async () => {
    try {
      while (hasQueuedValue) {
        const value = queuedValue
        hasQueuedValue = false
        try {
          await sync(value)
        } catch (reason) {
          onError(reason)
        }
      }
    } finally {
      drainPromise = undefined
    }
  }

  return (value: T) => {
    queuedValue = value
    hasQueuedValue = true
    drainPromise ??= drain()
    return drainPromise
  }
}

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
      const clickUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
      const data =
        options?.data && typeof options.data === "object"
          ? {url: clickUrl, ...options.data}
          : (options?.data ?? {url: clickUrl})
      await serviceWorker.showNotification(title, {
        ...options,
        data,
      })
    })
  } else if (nag) {
    const {alert} = await import("@/utils/utils")
    await alert("Notifications are not allowed. Please enable them first.")
  }
}

let subscriptionPromise: Promise<PushSubscription | null> | null = null
let subscriptionServer: string | null = null

async function getOrCreatePushSubscription() {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    return null
  }

  if (Notification.permission !== "granted") {
    return null
  }

  const server = useSettingsStore.getState().notifications.server
  if (subscriptionServer !== server) {
    subscriptionServer = server
    subscriptionPromise = null
  }

  if (!subscriptionPromise) {
    subscriptionPromise = (async () => {
      const reg = await navigator.serviceWorker.ready
      let pushSubscription = await reg.pushManager.getSubscription()
      const api = new IrisAPI(server)
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

  const pending = subscriptionPromise
  try {
    const subscription = await pending
    if (!subscription && subscriptionPromise === pending) subscriptionPromise = null
    return subscription
  } catch (error) {
    if (subscriptionPromise === pending) subscriptionPromise = null
    throw error
  }
}

export async function ensurePushSubscription(): Promise<boolean> {
  return Boolean(await getOrCreatePushSubscription())
}

interface DmNotificationSyncPlan {
  deleteIds: string[]
  register: boolean
  update?: [string, NotificationSubscription]
}

export function planDmNotificationSync(
  subscriptions: Record<string, NotificationSubscription>,
  webPushData: PushNotifications,
  sessionAuthors: string[],
  enabled: boolean
): DmNotificationSyncPlan {
  const managed = Object.entries(subscriptions).filter(
    ([, subscription]) =>
      subscription.filter.kinds?.length === 1 &&
      subscription.filter.kinds[0] === MESSAGE_EVENT_KIND &&
      !!subscription.filter.authors &&
      (subscription.web_push_subscriptions || []).some(
        ({endpoint}) => endpoint === webPushData.endpoint
      )
  )

  if (!enabled || sessionAuthors.length === 0) {
    return {deleteIds: managed.map(([id]) => id), register: false}
  }

  const [current, ...duplicates] = managed
  if (!current) {
    return {deleteIds: [], register: true}
  }

  const currentPush = current[1].web_push_subscriptions.find(
    ({endpoint}) => endpoint === webPushData.endpoint
  )
  const needsUpdate =
    !sameStringSet(current[1].filter.authors || [], sessionAuthors) ||
    !sameWebPushSubscription(currentPush, webPushData)

  return {
    deleteIds: duplicates.map(([id]) => id),
    register: false,
    ...(needsUpdate ? {update: current} : {}),
  }
}

let dmNotificationSyncGeneration = 0

const syncDmNotifications = async (generation: number) => {
  const isCurrent = () => generation === dmNotificationSyncGeneration
  const pushSubscription = await getOrCreatePushSubscription()
  if (!isCurrent() || !pushSubscription) {
    return
  }

  const {publicKey} = useUserStore.getState()
  if (!publicKey) {
    return
  }

  const store = useSettingsStore.getState()
  const dmsEnabled = store.notifications.preferences?.dms ?? true

  let sessionAuthors: string[] = []
  if (dmsEnabled) {
    try {
      const runtime = getNdrRuntime()
      if (!runtime.getState().sessionManagerReady) return
      sessionAuthors = extractSessionPubkeysFromUserRecords(
        runtime.getSessionUserRecords(),
        publicKey
      )
    } catch (err) {
      error("Failed to load session data for DM push subscription:", err)
      return
    }
  }

  const webPushData = buildWebPushData(pushSubscription)

  const messageFilter = {
    kinds: [MESSAGE_EVENT_KIND],
    authors: sessionAuthors,
  }

  const api = new IrisAPI(store.notifications.server)
  const currentSubscriptions = await api.getNotificationSubscriptions()
  if (!isCurrent()) return
  const plan = planDmNotificationSync(
    currentSubscriptions,
    webPushData,
    sessionAuthors,
    dmsEnabled
  )

  await Promise.all(plan.deleteIds.map((id) => api.deleteNotificationSubscription(id)))
  if (!isCurrent()) return

  if (plan.update) {
    const [id, subscription] = plan.update
    await api.updateNotificationSubscription(id, {
      ...subscription,
      filter: messageFilter,
      web_push_subscriptions: [webPushData],
    })
  } else if (plan.register) {
    await api.registerPushNotifications([webPushData], messageFilter)
  }
}

const queueDmNotificationSync = createLatestNotificationSyncQueue(syncDmNotifications)
const scheduleDmNotificationSync = debounce(queueDmNotificationSync, 5000)
export const subscribeToDMNotifications = () =>
  scheduleDmNotificationSync(++dmNotificationSyncGeneration)

// Helper function to compare arrays
function arrayEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((val, idx) => b[idx] === val)
}

function sameStringSet(a: string[], b: string[]) {
  const aSet = new Set(a)
  const bSet = new Set(b)
  return aSet.size === bSet.size && [...aSet].every((value) => bSet.has(value))
}

export function extractSessionPubkeysFromUserRecords(
  userRecords: SessionUserRecordsLike,
  ourPublicKey?: string
): string[] {
  return Array.from(
    new Set(
      Array.from(userRecords.entries())
        .filter(([publicKey]) => !ourPublicKey || publicKey !== ourPublicKey)
        .flatMap(([, {devices}]) =>
          Array.from(devices?.values() ?? []).flatMap((device) => {
            const sessions = [device.activeSession, ...(device.inactiveSessions ?? [])]
            return sessions.filter(Boolean)
          })
        )
        .flatMap((session) => {
          const state = session?.state
          if (!state) return []
          return [state.theirCurrentNostrPublicKey, state.theirNextNostrPublicKey]
        })
        .filter(
          (key): key is string =>
            typeof key === "string" && (!ourPublicKey || key !== ourPublicKey)
        )
    )
  )
}

let notificationSyncGeneration = 0

const syncNotifications = async (generation: number) => {
  const isCurrent = () => generation === notificationSyncGeneration
  if (!("serviceWorker" in navigator)) {
    return
  }

  const myPubKey = useUserStore.getState().publicKey

  if (!myPubKey) {
    return
  }

  try {
    const pushSubscription = await getOrCreatePushSubscription()
    if (!isCurrent() || !pushSubscription) {
      return
    }

    const store = useSettingsStore.getState()
    const api = new IrisAPI(store.notifications.server)
    const socialGraphFilter = store.notifications.socialGraphFilter

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
      log("No notification types enabled, removing managed push subscription if present")
    }

    const notificationFilter = {
      "#p": [myPubKey],
      kinds,
    }
    const webPushData = buildWebPushData(pushSubscription)

    // Check for existing subscription on notification server
    const currentSubscriptions = await api.getNotificationSubscriptions()
    if (!isCurrent()) return

    const managedSubscriptions = Object.entries(currentSubscriptions).filter(([, sub]) =>
      isManagedNotificationSubscription(sub, myPubKey, webPushData.endpoint)
    )
    const [existingSub, ...duplicateSubs] = managedSubscriptions

    if (duplicateSubs.length > 0) {
      await Promise.all(
        duplicateSubs.map(([id]) => api.deleteNotificationSubscription(id))
      )
      if (!isCurrent()) return
    }

    if (kinds.length === 0) {
      if (existingSub) {
        await api.deleteNotificationSubscription(existingSub[0])
      }
      return
    }

    if (existingSub) {
      const [id, sub] = existingSub
      const currentWebPushSubscription = (sub.web_push_subscriptions || []).find(
        (subscription) => subscription.endpoint === webPushData.endpoint
      )
      const needsUpdate =
        !arrayEqual(sub.filter["#p"] || [], notificationFilter["#p"]) ||
        !sameNumberSet(sub.filter.kinds || [], notificationFilter.kinds) ||
        !sameWebPushSubscription(currentWebPushSubscription, webPushData) ||
        !!sub.social_graph_filter !== socialGraphFilter

      if (needsUpdate) {
        await api.updateNotificationSubscription(id, {
          filter: notificationFilter,
          web_push_subscriptions: [webPushData],
          webhooks: [],
          fcm_tokens: sub.fcm_tokens || [],
          apns_tokens: sub.apns_tokens || [],
          subscriber: sub.subscriber,
          social_graph_filter: socialGraphFilter,
        })
      }
    } else {
      await api.registerPushNotifications(
        [webPushData],
        notificationFilter,
        undefined,
        socialGraphFilter
      )
    }
  } catch (e) {
    if (isCurrent()) error(e)
  }
}

const queueNotificationSync = createLatestNotificationSyncQueue(syncNotifications)
const scheduleNotificationSync = debounce(queueNotificationSync, 5000)
export const subscribeToNotifications = () =>
  scheduleNotificationSync(++notificationSyncGeneration)

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

function buildWebPushData(pushSubscription: PushSubscription): PushNotifications {
  return {
    endpoint: pushSubscription.endpoint,
    p256dh: base64.encode(new Uint8Array(pushSubscription.getKey("p256dh")!)),
    auth: base64.encode(new Uint8Array(pushSubscription.getKey("auth")!)),
  }
}

function isManagedNotificationSubscription(
  subscription: NotificationSubscription,
  myPubKey: string,
  endpoint: string
) {
  return (
    !subscription.filter.authors &&
    subscription.filter["#p"]?.length === 1 &&
    subscription.filter["#p"][0] === myPubKey &&
    (subscription.filter.kinds || []).every((kind) =>
      MANAGED_NOTIFICATION_KINDS.includes(kind)
    ) &&
    (subscription.web_push_subscriptions || []).some(
      (subscription) => subscription.endpoint === endpoint
    )
  )
}

function sameNumberSet(a: number[], b: number[]) {
  return a.length === b.length && a.every((value) => b.includes(value))
}

function sameWebPushSubscription(a: PushNotifications | undefined, b: PushNotifications) {
  return !!a && a.endpoint === b.endpoint && a.p256dh === b.p256dh && a.auth === b.auth
}
