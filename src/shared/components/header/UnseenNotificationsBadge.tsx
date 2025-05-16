import {useNotificationsStore} from "@/stores/notifications"

export default function UnseenNotificationsBadge() {
  const {latestNotification} = useNotificationsStore()
  const notificationsSeenAt = useNotificationsStore(
    (state) => state.notificationsSeenAt || 0
  )

  return (
    <>
      {notificationsSeenAt < latestNotification && (
        <div className="indicator-item badge badge-primary badge-xs"></div>
      )}
    </>
  )
}
