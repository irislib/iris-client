import HomeFeed from "@/pages/home/feed/components/HomeFeed.tsx"
import RightColumn from "@/shared/components/RightColumn.tsx"
import AlgorithmicFeed from "@/shared/components/feed/AlgorithmicFeed"
import {SocialGraphWidget} from "@/shared/components/SocialGraphWidget"
import {RelayStats} from "@/shared/components/RelayStats"
import Widget from "@/shared/components/ui/Widget.tsx"
import {useSettingsStore} from "@/stores/settings"
import {useIsLargeScreen} from "@/shared/hooks/useIsLargeScreen"
import {HomeRightColumn} from "@/pages/home/components/HomeRightColumn"
import PullToRefresh from "@/shared/components/ui/PullToRefresh"
import {
  useFeedStore,
  useFeedConfigs,
  useEnabledFeedIds,
  type FeedConfig,
} from "@/stores/feed"
import Header from "@/shared/components/header/Header"
import {useMemo} from "react"
import useFollows from "@/shared/hooks/useFollows"
import {usePublicKey} from "@/stores/user"
import {resolveAppAssetUrl} from "@/utils/nativeHtree"

function Index() {
  const {appearance} = useSettingsStore()
  const isLargeScreen = useIsLargeScreen()
  const triggerFeedRefresh = useFeedStore((state) => state.triggerFeedRefresh)
  const myPubKey = usePublicKey()
  const follows = useFollows(myPubKey, true)
  const {activeFeed, getAllFeedConfigs, loadFeedConfig} = useFeedStore()
  const enabledFeedIds = useEnabledFeedIds()
  const feedConfigs = useFeedConfigs()

  const allFeeds = useMemo(() => {
    return getAllFeedConfigs()
  }, [feedConfigs, enabledFeedIds, getAllFeedConfigs])

  const feeds = useMemo(() => {
    const feedsMap = new Map(allFeeds.map((feed) => [feed.id, feed]))
    return enabledFeedIds
      .map((id) => feedsMap.get(id))
      .filter((feed): feed is FeedConfig => feed !== undefined)
  }, [allFeeds, enabledFeedIds])

  const activeFeedItem = useMemo(
    () => feeds.find((f) => f.id === activeFeed) || feeds[0] || null,
    [activeFeed, feeds]
  )

  const activeFeedConfig = useMemo(
    () => loadFeedConfig(activeFeed),
    [loadFeedConfig, activeFeed, feedConfigs]
  )
  const navLogoUrl = resolveAppAssetUrl(CONFIG.navLogo)

  const feedName =
    follows.length <= 1
      ? "Home"
      : activeFeedConfig?.customName || activeFeedItem?.name || "Following"

  // On mobile, always show HomeFeed regardless of settings
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
              data-main-scroll-container="mobile"
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

  // When two-column layout is enabled on desktop (singleColumnLayout is false), HomeFeed is shown in Layout
  // So here we just show a placeholder message
  if (!appearance.singleColumnLayout) {
    return <HomeRightColumn />
  }

  // When single column layout is enabled on desktop, show the normal home layout
  return (
    <section
      className="flex w-full justify-center h-full overflow-hidden"
      data-main-scroll-container="single-column"
    >
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header showBack={false} showNotifications={true}>
          <span className="px-3 py-2">{feedName}</span>
        </Header>
        <div
          data-scrollable
          data-header-scroll-target
          className="flex-1 overflow-y-auto scrollbar-hide"
        >
          <HomeFeed />
        </div>
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
    </section>
  )
}

export default Index
