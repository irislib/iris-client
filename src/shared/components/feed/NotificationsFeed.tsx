import {
  clearNotifications,
  isNotificationUnread,
  notifications,
} from "@/utils/notifications"
import NotificationsFeedItem from "@/pages/notifications/NotificationsFeedItem"
import InfiniteScroll from "@/shared/components/ui/InfiniteScroll"
import {useEffect, useCallback, Suspense, useState} from "react"
import useHistoryState from "@/shared/hooks/useHistoryState"
import {useNotificationsStore} from "@/stores/notifications"
import {useLocation} from "@/navigation/hooks"
import runningOstrich from "@/assets/running-ostrich.gif"
import {useUserStore} from "@/stores/user"
import {startNotificationsSubscription} from "./notificationsSubscription"
import {useIsTopOfStack} from "@/navigation/useIsTopOfStack"

const INITIAL_DISPLAY_COUNT = 10
const DISPLAY_INCREMENT = 10

function NotificationsFeed() {
  const notificationsSeenAt = useNotificationsStore((state) => state.notificationsSeenAt)
  const publicKey = useUserStore((state) => state.publicKey)
  const readEvents = useNotificationsStore(
    (state) => state.readEventsByAccount[publicKey]
  )
  const [animationSeenAt, setAnimationSeenAt] = useState(notificationsSeenAt) // Initialize with current seen time
  const location = useLocation()
  const isTopOfStack = useIsTopOfStack()

  useEffect(() => {
    startNotificationsSubscription(publicKey || undefined)
  }, [publicKey])

  const [displayCount, setDisplayCount] = useHistoryState(
    INITIAL_DISPLAY_COUNT,
    "displayCount"
  )

  const {latestNotification: latestNotificationTime} = useNotificationsStore()

  const updateSeenAt = useCallback(() => {
    // Only update seen time if document visible AND view is top of stack
    if (
      document.visibilityState === "visible" &&
      isTopOfStack &&
      location.pathname === "/notifications"
    ) {
      // Set seen time immediately
      const newSeenTime = Math.round(Date.now() / 1000)
      useNotificationsStore.getState().setNotificationsSeenAt(newSeenTime)

      // Delay animation fade by 10 seconds
      setTimeout(() => {
        setAnimationSeenAt(newSeenTime)
      }, 10000)
    }
  }, [latestNotificationTime, notificationsSeenAt, location.pathname, isTopOfStack])

  useEffect(() => {
    updateSeenAt()
  }, [latestNotificationTime, updateSeenAt])

  // Dismiss this account's browser alerts when the inbox is actually visible.
  useEffect(() => {
    if (!publicKey || !isTopOfStack || location.pathname !== "/notifications") return
    const dismiss = () => {
      if (document.visibilityState === "visible") void clearNotifications({publicKey})
    }
    dismiss()
    document.addEventListener("visibilitychange", dismiss)
    return () => document.removeEventListener("visibilitychange", dismiss)
  }, [publicKey, location.pathname, isTopOfStack])

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
    <div className="w-full">
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
                highlight={isNotificationUnread(entry[1], animationSeenAt, readEvents)}
                key={entry[0]}
                notification={entry[1]}
              />
            ))
        ) : (
          <div className="p-8 flex flex-col gap-8 items-center justify-center text-base-content/50">
            No notifications yet
            <Suspense fallback={null}>
              <img src={runningOstrich} alt="" className="w-24" />
            </Suspense>
          </div>
        )}
      </InfiniteScroll>
    </div>
  )
}

export default NotificationsFeed
