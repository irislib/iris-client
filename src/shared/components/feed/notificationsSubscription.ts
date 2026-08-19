import {getSocialGraph, socialGraphLoaded} from "@/utils/socialGraph"
import {useSocialGraphStore} from "@/stores/socialGraph"
import {shouldHideUnsolicitedEvent} from "@/utils/visibility"
import {getTag, getZappingUser, getZapAmount} from "@/utils/nostr.ts"
import {notifications, Notification as IrisNotification} from "@/utils/notifications"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {useNotificationsStore} from "@/stores/notifications"
import {useUserStore} from "@/stores/user"
import {useSettingsStore} from "@/stores/settings"
import {cacheEvent} from "@/utils/eventCache"
import debounce from "lodash/debounce"
import {ndk} from "@/utils/ndk"
import {NDKEvent, NDKSubscription} from "@/lib/ndk"
import {
  KIND_REACTION,
  KIND_REPOST,
  KIND_TEXT_NOTE,
  KIND_ZAP_RECEIPT,
  KIND_HIGHLIGHT,
  KIND_PICTURE_FIRST,
  DEBUG_NAMESPACES,
} from "@/utils/constants"
import {createDebugLogger} from "@/utils/createDebugLogger"

const {log, warn} = createDebugLogger(DEBUG_NAMESPACES.UI_FEED)

let sub: NDKSubscription | undefined
let unsubscribeFromGraph: (() => void) | undefined
let unsubscribeFromSettings: (() => void) | undefined
let unsubscribeFromAuth: (() => void) | undefined
let cancelPendingReadyWait: (() => void) | undefined
let subscriptionGeneration = 0
let notificationsSubscriptionEnabled = false

const hasReadyGraphFor = (publicKey: string) =>
  useSocialGraphStore.getState().isReady && getSocialGraph().getRoot() === publicKey

const resetLatestNotification = () => {
  let latest = 0
  for (const notification of notifications.values()) {
    latest = Math.max(latest, notification.time)
  }
  const store = useNotificationsStore.getState()
  store.setLatestNotification(latest)
  store.updateRefreshRouteSignal()
  return latest
}

const clearNotificationCollection = () => {
  notifications.clear()
  const store = useNotificationsStore.getState()
  store.setLatestNotification(0)
  store.updateRefreshRouteSignal()
}

const disposeActiveSubscription = () => {
  const previousSub = sub
  const previousGraphUnsubscribe = unsubscribeFromGraph
  const previousSettingsUnsubscribe = unsubscribeFromSettings
  sub = undefined
  unsubscribeFromGraph = undefined
  unsubscribeFromSettings = undefined
  previousGraphUnsubscribe?.()
  previousSettingsUnsubscribe?.()
  previousSub?.stop()
}

const cancelPendingAndActiveSubscription = () => {
  subscriptionGeneration += 1
  scheduleNotificationsSubscription.cancel()
  cancelPendingReadyWait?.()
  disposeActiveSubscription()
}

// Clean up notifications from muted users by filtering out muted events
const cleanupHiddenNotifications = () => {
  let cleanedCount = 0
  const toRemove: string[] = []
  const toReinsert: Array<[string, IrisNotification]> = []

  for (const [key, notification] of notifications) {
    // Skip if no events array (old cached notifications)
    if (!notification.events || notification.events.length === 0) {
      continue
    }

    // Filter with the same sender-aware policy used when admitting live events.
    // In particular, zap receipts are signed by a service while `user` is the
    // actual zap sender whose visibility must be checked.
    const cleanedEvents = notification.events.filter((notifEvent) => {
      if (shouldHideUnsolicitedEvent(notifEvent.event, notifEvent.user)) {
        cleanedCount++
        return false
      }
      return true
    })

    if (cleanedEvents.length === 0) {
      // No valid events left, remove entire notification
      toRemove.push(key)
    } else if (cleanedEvents.length !== notification.events.length) {
      // Some events were filtered, update the notification
      notification.events = cleanedEvents

      const latestEvent = cleanedEvents.reduce((latest, current) =>
        current.time > latest.time ? current : latest
      )
      notification.time = latestEvent.time
      notification.id = latestEvent.event.id
      notification.tags = latestEvent.event.tags
      if (
        notification.kind === KIND_TEXT_NOTE ||
        notification.kind === KIND_PICTURE_FIRST
      ) {
        notification.content = latestEvent.content || ""
      }

      // Rebuild users map from cleaned events for backward compatibility
      notification.users.clear()
      for (const notifEvent of cleanedEvents) {
        notification.users.set(notifEvent.user, {
          time: notifEvent.time,
          content: notifEvent.content,
          eventId: notifEvent.event.id,
        })
      }
      toReinsert.push([key, notification])
    }
  }

  // SortedMap derives order when an entry is inserted. Remove changed entries
  // before re-adding them so a newly exposed older event moves to its true slot.
  const changedKeys = [...toRemove, ...toReinsert.map(([key]) => key)]
  changedKeys.forEach((key) => notifications.delete(key))
  toReinsert.forEach(([key, notification]) => notifications.set(key, notification))
  const latest = resetLatestNotification()

  if (cleanedCount > 0 || toRemove.length > 0) {
    log(`Cleaned ${cleanedCount} events and removed ${toRemove.length} notifications`)
  }
  return latest
}

const waitForReadyGraph = async (myPubKey: string, generation: number) => {
  await socialGraphLoaded
  if (
    generation !== subscriptionGeneration ||
    useUserStore.getState().publicKey !== myPubKey
  ) {
    return false
  }
  if (hasReadyGraphFor(myPubKey)) return true

  return new Promise<boolean>((resolve) => {
    let settled = false
    const unsubscribeWaiters: Array<() => void> = []

    function finish(ready: boolean) {
      if (settled) return
      settled = true
      if (cancelPendingReadyWait === cancelThisWait) {
        cancelPendingReadyWait = undefined
      }
      unsubscribeWaiters.forEach((unsubscribe) => unsubscribe())
      resolve(ready)
    }
    const cancelThisWait = () => finish(false)
    const check = () => {
      if (
        generation !== subscriptionGeneration ||
        useUserStore.getState().publicKey !== myPubKey
      ) {
        finish(false)
      } else if (hasReadyGraphFor(myPubKey)) {
        finish(true)
      }
    }

    unsubscribeWaiters.push(
      useSocialGraphStore.subscribe(check),
      useUserStore.subscribe(check)
    )
    cancelPendingReadyWait = cancelThisWait
    check()
  })
}

const startNotificationsSubscriptionNow = async (
  myPubKey: string,
  generation: number
) => {
  if (!(await waitForReadyGraph(myPubKey, generation))) return
  if (generation !== subscriptionGeneration || !hasReadyGraphFor(myPubKey)) return

  disposeActiveSubscription()
  if (generation !== subscriptionGeneration || !hasReadyGraphFor(myPubKey)) return

  let latest = cleanupHiddenNotifications()

  const kinds: number[] = [
    KIND_REACTION,
    KIND_REPOST,
    KIND_TEXT_NOTE, // replies
    KIND_ZAP_RECEIPT,
    KIND_HIGHLIGHT,
    KIND_PICTURE_FIRST, // when tagged
  ]

  const filters = {
    kinds: kinds,
    ["#p"]: [myPubKey],
    limit: 100,
  }

  const nextSub = ndk().subscribe(filters)
  if (generation !== subscriptionGeneration || !hasReadyGraphFor(myPubKey)) {
    nextSub.stop()
    return
  }
  sub = nextSub

  const graphUnsubscribe = useSocialGraphStore.subscribe((state, previousState) => {
    if (generation !== subscriptionGeneration || sub !== nextSub) return

    // Events received while the graph is being re-rooted/hydrated are rejected.
    // Reopen the subscription once the stable snapshot is ready so its history
    // query recovers anything that arrived during that interval.
    if (!previousState.isReady && state.isReady && hasReadyGraphFor(myPubKey)) {
      const nextGeneration = ++subscriptionGeneration
      cancelPendingReadyWait?.()
      scheduleNotificationsSubscription(myPubKey, nextGeneration)
      return
    }
    if (!hasReadyGraphFor(myPubKey)) return

    if (
      state.version !== previousState.version ||
      state.muteListVersion !== previousState.muteListVersion
    ) {
      latest = cleanupHiddenNotifications()
    }
  })
  unsubscribeFromGraph = graphUnsubscribe
  const settingsUnsubscribe = useSettingsStore.subscribe((state, previousState) => {
    if (generation !== subscriptionGeneration || sub !== nextSub) return
    if (
      state.content.maxFollowDistanceForReplies !==
      previousState.content.maxFollowDistanceForReplies
    ) {
      // Tightening removes newly hidden senders immediately. Loosening does not
      // resurrect historical entries; the next graph/subscription refresh will.
      latest = cleanupHiddenNotifications()
    }
  })
  unsubscribeFromSettings = settingsUnsubscribe
  nextSub.on("close", () => {
    if (sub === nextSub) sub = undefined
    if (unsubscribeFromGraph === graphUnsubscribe) {
      unsubscribeFromGraph = undefined
      graphUnsubscribe()
    }
    if (unsubscribeFromSettings === settingsUnsubscribe) {
      unsubscribeFromSettings = undefined
      settingsUnsubscribe()
    }
  })

  nextSub.on("event", async (event: NDKEvent) => {
    const user = event.kind === KIND_ZAP_RECEIPT ? getZappingUser(event) : event.pubkey
    if (!user) {
      warn("no user for event", event)
      return
    }

    const eTag = getTag("e", event.tags)
    if (!eTag || !event.created_at) return

    const canUseEvent = () =>
      generation === subscriptionGeneration &&
      sub === nextSub &&
      hasReadyGraphFor(myPubKey) &&
      (event.kind === KIND_ZAP_RECEIPT || event.pubkey !== myPubKey) &&
      !shouldHideUnsolicitedEvent(event, user)

    if (!canUseEvent()) return

    let content: string | undefined = undefined
    if (event.kind === KIND_TEXT_NOTE || event.kind === KIND_REACTION) {
      content = event.content
    } else if (event.kind === KIND_ZAP_RECEIPT) {
      const zapAmount = await getZapAmount(event)
      content = zapAmount > 0 ? zapAmount.toString() : undefined
    } else if (event.kind === KIND_PICTURE_FIRST) {
      content = event.content
    }

    // Zap amount parsing is asynchronous. Recheck auth generation, graph
    // readiness, and current visibility immediately before every mutation.
    if (!canUseEvent()) return

    cacheEvent(event)

    {
      const key = `${eTag}-${event.kind}`

      const notification =
        notifications.get(key) ||
        ({
          id: event.id,
          originalEventId: eTag,
          users: new SortedMap([], "time"),
          events: [], // Initialize events array
          kind: event.kind,
          time: event.created_at,
          content: event.content,
          tags: event.tags,
        } as IrisNotification)
      // Add event to the events array
      const existingEventIndex = notification.events.findIndex((e) => e.user === user)
      if (
        existingEventIndex === -1 ||
        notification.events[existingEventIndex].time < event.created_at
      ) {
        const notificationEvent = {
          event,
          user,
          time: event.created_at,
          content,
        }

        if (existingEventIndex !== -1) {
          notification.events[existingEventIndex] = notificationEvent
        } else {
          notification.events.push(notificationEvent)
        }

        // Also update the old users map for backward compatibility
        notification.users.set(user, {
          time: event.created_at,
          content,
          eventId: event.id,
        })
      }
      if (event.created_at > notification.time) {
        notification.time = event.created_at
        // Update notification content with the latest reply/reaction
        if (event.kind === KIND_TEXT_NOTE && event.content) {
          // For text notes (replies), update the notification content and ID to show the latest reply
          notification.content = event.content
          notification.id = event.id
        } else if (event.kind === KIND_PICTURE_FIRST && event.content) {
          // For picture-first posts, update the notification content
          notification.content = event.content
        }
      }

      notifications.set(key, notification)

      const store = useNotificationsStore.getState()
      if (event.created_at > latest) {
        latest = event.created_at
        store.setLatestNotification(latest)
      } else {
        store.updateRefreshRouteSignal()
      }
    }
  })
}

const scheduleNotificationsSubscription = debounce(
  (myPubKey: string, generation: number) => {
    void startNotificationsSubscriptionNow(myPubKey, generation)
  },
  500
)

const ensureAuthSubscription = () => {
  if (unsubscribeFromAuth) return
  unsubscribeFromAuth = useUserStore.subscribe((state, previousState) => {
    if (state.publicKey === previousState.publicKey) return

    clearNotificationCollection()
    cancelPendingAndActiveSubscription()
    if (notificationsSubscriptionEnabled && state.publicKey) {
      const generation = ++subscriptionGeneration
      cancelPendingReadyWait?.()
      scheduleNotificationsSubscription(state.publicKey, generation)
    }
  })
}

export const startNotificationsSubscription = (myPubKey?: string) => {
  notificationsSubscriptionEnabled = true
  ensureAuthSubscription()
  if (!myPubKey || typeof myPubKey !== "string") {
    clearNotificationCollection()
    cancelPendingAndActiveSubscription()
    return
  }

  const generation = ++subscriptionGeneration
  cancelPendingReadyWait?.()
  scheduleNotificationsSubscription(myPubKey, generation)
}

export const stopNotificationsSubscription = () => {
  notificationsSubscriptionEnabled = false
  cancelPendingAndActiveSubscription()
  const previousAuthUnsubscribe = unsubscribeFromAuth
  unsubscribeFromAuth = undefined
  previousAuthUnsubscribe?.()
}
