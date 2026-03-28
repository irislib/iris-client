import {useSettingsStore} from "@/stores/settings"
import {getSocialGraph, socialGraphLoaded} from "@/utils/socialGraph"
import {useSocialGraphStore} from "@/stores/socialGraph"
import {shouldHideUser, shouldHideEvent} from "@/utils/visibility"
import {getTag, getZappingUser, getZapAmount} from "@/utils/nostr.ts"
import {notifications, Notification as IrisNotification} from "@/utils/notifications"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {useNotificationsStore} from "@/stores/notifications"
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

// Clean up notifications from muted users by filtering out muted events
const cleanupMutedNotifications = () => {
  let cleanedCount = 0
  const toRemove: string[] = []

  for (const [key, notification] of notifications) {
    // Skip if no events array (old cached notifications)
    if (!notification.events || notification.events.length === 0) {
      continue
    }

    // Filter events array to remove muted users and events mentioning muted users
    const cleanedEvents = notification.events.filter((notifEvent) => {
      // Check if we should hide this event (author or mentions)
      if (shouldHideEvent(notifEvent.event)) {
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

      // Find the latest event for TEXT_NOTE notifications
      if (notification.kind === KIND_TEXT_NOTE) {
        const latestEvent = cleanedEvents.reduce((latest, current) =>
          current.time > latest.time ? current : latest
        )

        notification.content = latestEvent.content || ""
        notification.time = latestEvent.time
        notification.id = latestEvent.event.id
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
    }
  }

  // Remove empty notifications
  toRemove.forEach((key) => notifications.delete(key))

  if (cleanedCount > 0 || toRemove.length > 0) {
    log(`Cleaned ${cleanedCount} events and removed ${toRemove.length} notifications`)
  }
}

export const startNotificationsSubscription = debounce(async (myPubKey?: string) => {
  if (!myPubKey || typeof myPubKey !== "string") return

  await socialGraphLoaded

  sub?.stop()

  // Subscribe to mute list changes via Zustand store
  let previousMuteListVersion = useSocialGraphStore.getState().muteListVersion
  const unsubscribe = useSocialGraphStore.subscribe((state) => {
    if (state.muteListVersion !== previousMuteListVersion) {
      previousMuteListVersion = state.muteListVersion
      cleanupMutedNotifications()
    }
  })

  // Store unsubscribe for cleanup
  if (sub) {
    sub.on("close", () => unsubscribe())
  }

  cleanupMutedNotifications()

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

  sub = ndk().subscribe(filters)

  let latest = 0

  const settings = useSettingsStore.getState()
  const maxFollowDistanceForReplies = settings.content?.maxFollowDistanceForReplies

  sub.on("event", async (event: NDKEvent) => {
    if (event.kind !== KIND_ZAP_RECEIPT) {
      // allow zap notifs from self & unknown users
      if (event.pubkey === myPubKey) return
      if (
        maxFollowDistanceForReplies !== undefined &&
        getSocialGraph().getFollowDistance(event.pubkey) > maxFollowDistanceForReplies
      )
        return
      // Use shouldHideEvent which checks both author and mentions
      if (shouldHideEvent(event)) return
    } else {
      // For zap notifications, check the zapping user
      const zappingUser = getZappingUser(event)
      if (zappingUser && shouldHideUser(zappingUser)) return
    }
    const eTag = getTag("e", event.tags)
    if (eTag && event.created_at) {
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
      const user = event.kind === KIND_ZAP_RECEIPT ? getZappingUser(event) : event.pubkey
      if (!user) {
        warn("no user for event", event)
        return
      }

      // Don't add muted users to existing notifications either
      if (shouldHideUser(user)) {
        return
      }

      // Add event to the events array
      const existingEventIndex = notification.events.findIndex((e) => e.user === user)
      if (
        existingEventIndex === -1 ||
        notification.events[existingEventIndex].time < event.created_at
      ) {
        let content: string | undefined = undefined
        if (event.kind === KIND_TEXT_NOTE) {
          content = event.content
        } else if (event.kind === KIND_REACTION) {
          content = event.content
        } else if (event.kind === KIND_ZAP_RECEIPT) {
          const zapAmount = await getZapAmount(event)
          content = zapAmount > 0 ? zapAmount.toString() : undefined
        } else if (event.kind === KIND_PICTURE_FIRST) {
          content = event.content
        }

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

      if (event.created_at > latest) {
        latest = event.created_at
        useNotificationsStore.getState().setLatestNotification(event.created_at)
      }
    }
  })
}, 500)
