import {
  notifications,
  Notification as IrisNotification,
  maybeShowPushNotification,
} from "@/utils/notifications"
import NotificationsFeedItem from "@/pages/notifications/NotificationsFeedItem"
import InfiniteScroll from "@/shared/components/ui/InfiniteScroll"
import useHistoryState from "@/shared/hooks/useHistoryState"
import {useNotificationsStore} from "@/stores/notifications"
import {NDKEvent, NDKSubscription} from "@nostr-dev-kit/ndk"
import runningOstrich from "@/assets/running-ostrich.gif"
import {getTag, getZappingUser} from "@/utils/nostr.ts"
import {useEffect, useCallback, useState} from "react"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {useSettingsStore} from "@/stores/settings"
import socialGraph from "@/utils/socialGraph"
import {useUserStore} from "@/stores/user"
import debounce from "lodash/debounce"
import {ndk} from "@/utils/ndk"

const INITIAL_DISPLAY_COUNT = 10
const DISPLAY_INCREMENT = 10

let sub: NDKSubscription | undefined

const getNotifications = debounce((myPubKey?: string) => {
  if (!myPubKey || typeof myPubKey !== "string") return

  sub?.stop()

  const kinds: number[] = [
    7, // reactions
    6, // reposts
    1, // replies
    9735, // zap receipts
    9802, // highlights
  ]

  const filters = {
    kinds: kinds,
    ["#p"]: [myPubKey],
    limit: 100,
  }

  sub = ndk().subscribe(filters)

  let latest = 0

  const hideEventsByUnknownUsers =
    useSettingsStore.getState().content.hideEventsByUnknownUsers

  sub.on("event", (event: NDKEvent) => {
    if (event.kind !== 9735) {
      // allow zap notifs from self & unknown users
      if (event.pubkey === myPubKey) return
      if (hideEventsByUnknownUsers && socialGraph().getFollowDistance(event.pubkey) > 5)
        return
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
          kind: event.kind,
          time: event.created_at,
          content: event.content,
          tags: event.tags,
        } as IrisNotification)
      const user = event.kind === 9735 ? getZappingUser(event) : event.pubkey
      if (!user) {
        console.warn("no user for event", event)
        return
      }
      const existing = notification.users.get(user)
      if (!existing || existing.time < event.created_at) {
        notification.users.set(user, {time: event.created_at})
      }
      if (event.created_at > notification.time) {
        notification.time = event.created_at
      }

      notifications.set(key, notification)
      maybeShowPushNotification(event)

      const created_at = event.created_at * 1000

      if (created_at > latest) {
        latest = created_at
        useNotificationsStore.getState().setLatestNotification(latest)
      }
    }
  })
}, 2000)

function NotificationsFeed() {
  const notificationsSeenAt = useNotificationsStore((state) => state.notificationsSeenAt)
  useEffect(() => {
    const unsubscribe = useUserStore.subscribe((state) => {
      if (state.publicKey) {
        notifications.clear()
        getNotifications(state.publicKey)
      }
    })
    return () => unsubscribe()
  }, [])

  const [displayCount, setDisplayCount] = useHistoryState(
    INITIAL_DISPLAY_COUNT,
    "displayCount"
  )

  const {latestNotification: latestNotificationTime} = useNotificationsStore()

  const [initialNotificationsSeenAt, setInitialNotificationsSeenAt] =
    useState(notificationsSeenAt)
  useEffect(() => {
    if (initialNotificationsSeenAt === 0) {
      setInitialNotificationsSeenAt(notificationsSeenAt)
    }
  }, [notificationsSeenAt])
  console.log("initialNotificationsSeenAt", initialNotificationsSeenAt)

  const updateSeenAt = useCallback(() => {
    if (document.hasFocus()) {
      setTimeout(() => {
        useNotificationsStore.getState().setNotificationsSeenAt(Date.now())
      }, 1000)
    }
  }, [latestNotificationTime, notificationsSeenAt])

  useEffect(() => {
    updateSeenAt()
  }, [latestNotificationTime, updateSeenAt])

  useEffect(() => {
    const handleUpdate = () => updateSeenAt()

    document.addEventListener("visibilitychange", handleUpdate)
    document.addEventListener("input", handleUpdate)
    document.addEventListener("mousemove", handleUpdate)
    document.addEventListener("scroll", handleUpdate)

    return () => {
      document.removeEventListener("visibilitychange", handleUpdate)
      document.removeEventListener("input", handleUpdate)
      document.removeEventListener("mousemove", handleUpdate)
      document.removeEventListener("scroll", handleUpdate)
    }
  }, [updateSeenAt])

  useEffect(() => {
    // Check and request notification permission
    if (
      window.Notification &&
      window.Notification.permission !== "granted" &&
      window.Notification.permission !== "denied"
    ) {
      window.Notification.requestPermission()
    }

    // ... existing effect logic ...
  }, []) // Empty dependency array for initialization

  return (
    <div className="w-full overflow-hidden">
      <InfiniteScroll
        onLoadMore={() => {
          if (notifications.size > displayCount) {
            setDisplayCount(displayCount + DISPLAY_INCREMENT)
          }
        }}
      >
        {notifications.size > 0 ? (
          Array.from(notifications.entries())
            .reverse()
            .slice(0, displayCount)
            .map((entry) => (
              <NotificationsFeedItem
                highlight={entry[1].time > initialNotificationsSeenAt}
                key={entry[0]}
                notification={entry[1]}
              />
            ))
        ) : (
          <div className="p-8 flex flex-col gap-8 items-center justify-center text-base-content/50">
            No notifications yet
            <img src={runningOstrich} alt="" className="w-24" />
          </div>
        )}
      </InfiniteScroll>
    </div>
  )
}

export default NotificationsFeed
