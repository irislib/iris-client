import NotificationsFeed from "@/shared/components/feed/NotificationsFeed.tsx"
import RightColumn from "@/shared/components/RightColumn"
import AlgorithmicFeed from "@/shared/components/feed/AlgorithmicFeed"
import {SocialGraphWidget} from "@/shared/components/SocialGraphWidget"
import {RelayStats} from "@/shared/components/RelayStats"
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
    <section
      className="flex flex-col h-full overflow-y-scroll overflow-x-hidden"
      data-main-scroll-container="true"
    >
      <Header title="Notifications" />
      <div className="flex flex-1 relative">
        <div className="flex flex-col flex-1 gap-2 pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))] md:pt-16 md:pb-0">
          <NotificationsFeed />
        </div>
        <RightColumn>
          {() => (
            <>
              <SocialGraphWidget />
              <RelayStats />
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
    </section>
  )
}

export default Notifications
