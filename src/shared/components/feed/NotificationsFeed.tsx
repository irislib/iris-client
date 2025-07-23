import {notifications} from "@/utils/notifications"
import NotificationsFeedItem from "@/pages/notifications/NotificationsFeedItem"
import InfiniteScroll from "@/shared/components/ui/InfiniteScroll"
import {useEffect, useCallback, useState, Suspense} from "react"
import useHistoryState from "@/shared/hooks/useHistoryState"
import {useNotificationsStore} from "@/stores/notifications"
import runningOstrich from "@/assets/running-ostrich.gif"
import {useUserStore} from "@/stores/user"
import {startNotificationsSubscription} from "./notificationsSubscription"

const INITIAL_DISPLAY_COUNT = 10
const DISPLAY_INCREMENT = 10

function NotificationsFeed() {
  const notificationsSeenAt = useNotificationsStore((state) => state.notificationsSeenAt)
  const publicKey = useUserStore((state) => state.publicKey)

  useEffect(() => {
    if (publicKey) {
      startNotificationsSubscription(publicKey)
    }

    const unsubscribe = useUserStore.subscribe((state, prevState) => {
      if (state.publicKey && state.publicKey !== prevState.publicKey) {
        notifications.clear()
        startNotificationsSubscription(state.publicKey)
      }
    })
    return () => unsubscribe()
  }, [publicKey])

  const [displayCount, setDisplayCount] = useHistoryState(
    INITIAL_DISPLAY_COUNT,
    "displayCount"
  )

  const {latestNotification: latestNotificationTime} = useNotificationsStore()

  const [initialNotificationsSeenAt] = useState(notificationsSeenAt)
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
            <Suspense fallback={<div>Loading...</div>}>
              <img src={runningOstrich} alt="" className="w-24" />
            </Suspense>
          </div>
        )}
      </InfiniteScroll>
    </div>
  )
}

export default NotificationsFeed
