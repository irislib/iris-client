import NotificationsFeed from "@/shared/components/feed/NotificationsFeed.tsx"
import RightColumn from "@/shared/components/RightColumn"
import Trending from "@/shared/components/feed/Trending"
import Header from "@/shared/components/header/Header"
import Widget from "@/shared/components/ui/Widget"

import {subscribeToNotifications} from "@/utils/notifications"
import {useEffect} from "react"
let subscribed = false

function Notifications() {
  useEffect(() => {
    if (subscribed) {
      return
    }
    subscribeToNotifications()
    subscribed = true
  })

  return (
    <section className="flex flex-1 relative">
      <div className="flex flex-col flex-1 gap-2">
        <Header title="Notifications" />
        <NotificationsFeed />
      </div>
      <RightColumn>
        {() => (
          <>
            <Widget title="Trending posts">
              <Trending />
            </Widget>
          </>
        )}
      </RightColumn>
    </section>
  )
}

export default Notifications
