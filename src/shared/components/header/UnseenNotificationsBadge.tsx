import {useNotificationsStore} from "@/stores/notifications"

export default function UnseenNotificationsBadge() {
  const {latestNotification} = useNotificationsStore()
  const notificationsSeenAt = useNotificationsStore(
    (state) => state.notificationsSeenAt || 0
  )

  const shouldShow = notificationsSeenAt < latestNotification && latestNotification > 0

  return (
    <>
      {shouldShow && (
        <div className="indicator-item badge badge-primary badge-xs"></div>
      )}
    </>
  )
}
