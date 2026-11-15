import HomeFeed from "@/pages/home/feed/components/HomeFeed.tsx"
import RightColumn from "@/shared/components/RightColumn.tsx"
import PopularWidget from "@/shared/components/feed/PopularWidget"
import {SocialGraphWidget} from "@/shared/components/SocialGraphWidget"
import {useIsLargeScreen} from "@/shared/hooks/useIsLargeScreen"
import PullToRefresh from "@/shared/components/ui/PullToRefresh"
import {useFeedStore} from "@/stores/feed"
import Header from "@/shared/components/header/Header"
import useFollows from "@/shared/hooks/useFollows"
import {usePublicKey} from "@/stores/user"
import {resolveAppAssetUrl} from "@/utils/nativeHtree"

function Index() {
  const isLargeScreen = useIsLargeScreen()
  const triggerFeedRefresh = useFeedStore((state) => state.triggerFeedRefresh)
  const myPubKey = usePublicKey()
  const follows = useFollows(myPubKey, true)
  const activeFeedName = useFeedStore(({activeFeed, feedConfigs, getAllFeedConfigs}) => {
    const feeds = getAllFeedConfigs()
    return (
      feedConfigs[activeFeed]?.customName ||
      (feeds.find((feed) => feed.id === activeFeed) ?? feeds[0])?.name ||
      "Following"
    )
  })
  const feedName = follows.length <= 1 ? "Home" : activeFeedName
  const navLogoUrl = resolveAppAssetUrl(CONFIG.navLogo)

  if (!isLargeScreen) {
    return (
      <div className="relative h-full">
        <Header showBack={false} showNotifications={true}>
          <div className="flex items-center justify-between w-full relative md:static">
            {/* Feed name - hidden initially on mobile, always shown on desktop */}
            <div
              className="absolute inset-0 flex items-center md:static opacity-0 md:opacity-100"
              data-header-feed-name
            >
              <span className="transition-opacity duration-200 ml-2 md:px-3 md:py-2">
                {feedName}
              </span>
            </div>
            {/* Iris logo - shown initially at top on mobile, hidden on desktop */}
            <div
              className="flex items-center gap-2 transition-opacity duration-200 md:hidden ml-2 absolute inset-0 opacity-100"
              data-header-logo
            >
              <img className="w-7 h-7" src={navLogoUrl} alt={CONFIG.appName} />
              <span className="font-bold text-3xl">{CONFIG.appName}</span>
            </div>
          </div>
        </Header>
        <div className="absolute inset-0">
          <PullToRefresh onRefresh={triggerFeedRefresh}>
            <section
              data-scrollable
              data-header-scroll-target
              className="h-full overflow-y-auto scrollbar-hide relative"
              data-main-scroll-container
            >
              <div className="pt-[calc(4rem+env(safe-area-inset-top))]">
                <HomeFeed />
                <div className="h-44" aria-hidden="true" />
              </div>
            </section>
          </PullToRefresh>
        </div>
      </div>
    )
  }

  return (
    <section className="flex w-full justify-center h-full overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header showBack={false} showNotifications={true}>
          <span className="px-3 py-2">{feedName}</span>
        </Header>
        <div
          data-scrollable
          data-header-scroll-target
          data-main-scroll-container
          className="flex-1 overflow-y-auto scrollbar-hide"
        >
          <HomeFeed />
        </div>
      </div>
      <RightColumn>
        <SocialGraphWidget />
        <PopularWidget />
      </RightColumn>
    </section>
  )
}

export default Index
