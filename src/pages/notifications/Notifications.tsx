import NotificationsFeed from "@/shared/components/feed/NotificationsFeed.tsx"
import RightColumn from "@/shared/components/RightColumn"
import AlgorithmicFeed from "@/shared/components/feed/AlgorithmicFeed"
import {SocialGraphWidget} from "@/shared/components/SocialGraphWidget"
import Header from "@/shared/components/header/Header"
import Widget from "@/shared/components/ui/Widget"
import {ScrollablePageContainer} from "@/shared/components/layout/ScrollablePageContainer"
import {useToastStore, type Toast} from "@/stores/toast"
import {Link} from "@/navigation"

import {subscribeToNotifications} from "@/utils/notifications"
import {useEffect} from "react"
let subscribed = false

function Notifications() {
  const {dismissedToasts, clearDismissed} = useToastStore()

  useEffect(() => {
    if (subscribed) {
      return
    }
    subscribeToNotifications()
    subscribed = true
  })

  useEffect(() => {
    return () => {
      clearDismissed()
    }
  }, [])

  const getAlertClass = (type: string) => {
    switch (type) {
      case "success":
        return "alert-success"
      case "error":
        return "alert-error"
      case "warning":
        return "alert-warning"
      case "info":
      default:
        return "alert-info"
    }
  }

  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return ""
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return "just now"
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  }

  const renderToastContent = (toast: Toast) => {
    if (toast.linkTo) {
      return (
        <Link to={toast.linkTo} className="flex-1 hover:underline cursor-pointer">
          {toast.message}
        </Link>
      )
    }
    return <span className="flex-1">{toast.message}</span>
  }

  return (
    <div className="flex flex-1 relative h-full">
      <div className="flex flex-col flex-1 h-full relative">
        <Header title="Notifications" />
        <ScrollablePageContainer>
          {dismissedToasts.length > 0 && (
            <div className="flex flex-col gap-2 p-4 border-b border-base-300">
              {dismissedToasts.map((toast) => (
                <div
                  key={toast.id}
                  className={`alert ${getAlertClass(toast.type)} shadow-sm flex items-center gap-2`}
                >
                  {renderToastContent(toast)}
                  <span className="text-xs opacity-70 whitespace-nowrap">
                    {formatTimestamp(toast.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <NotificationsFeed />
        </ScrollablePageContainer>
      </div>
      <RightColumn>
        {() => (
          <>
            <SocialGraphWidget />
            <Widget title="Popular" className="h-96">
              <AlgorithmicFeed
                type="popular"
                displayOptions={{
                  small: true,
                  showDisplaySelector: false,
                }}
              />
            </Widget>
          </>
        )}
      </RightColumn>
    </div>
  )
}

export default Notifications
