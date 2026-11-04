import {useNotificationsStore} from "@/stores/notifications"
import {useEffect} from "react"
import {useUserStore} from "@/stores/user"
import {startNotificationsSubscription} from "@/shared/components/feed/notificationsSubscription"
import {isNotificationUnread, notifications} from "@/utils/notifications"

export default function UnseenNotificationsBadge() {
  const {notificationsSeenAt, readEventsByAccount} = useNotificationsStore()

  // Ensure we start the subscription as soon as the user is logged in
  const publicKey = useUserStore((state) => state.publicKey)

  useEffect(() => {
    if (publicKey) {
      startNotificationsSubscription(publicKey)
    }
  }, [publicKey])

  const shouldShow =
    !!publicKey &&
    Array.from(notifications.values()).some((notification) =>
      isNotificationUnread(
        notification,
        notificationsSeenAt,
        readEventsByAccount[publicKey]
      )
    )

  return (
    <>
      {shouldShow && <div className="indicator-item badge badge-primary badge-xs"></div>}
    </>
  )
}
