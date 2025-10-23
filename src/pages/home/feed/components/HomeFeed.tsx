import {useMemo, useState, useEffect, useRef} from "react"

import PublicKeyQRCodeButton from "@/shared/components/user/PublicKeyQRCodeButton"
import NotificationPrompt from "@/shared/components/NotificationPrompt"
import AlgorithmicFeed from "@/shared/components/feed/AlgorithmicFeed"
import Feed from "@/shared/components/feed/Feed.tsx"
import useFollows from "@/shared/hooks/useFollows"
import {useSocialGraphLoaded} from "@/utils/socialGraph"
import {usePublicKey} from "@/stores/user"
import {useUIStore} from "@/stores/ui"
import {
  useFeedStore,
  useEnabledFeedIds,
  useFeedConfigs,
  type FeedConfig,
  getFeedCacheKey,
} from "@/stores/feed"
import FeedTabs from "@/shared/components/feed/FeedTabs"
import StoredFeedEditor from "@/shared/components/feed/StoredFeedEditor"
import InlineNoteCreator from "@/shared/components/create/InlineNoteCreator"
import {confirm} from "@/utils/utils"

const NoFollows = ({myPubKey}: {myPubKey?: string}) =>
  myPubKey ? (
    <div className="flex flex-col gap-8 items-center justify-center text-base-content/50">
      <div className="px-4 py-8 border-b border-base-300 flex flex-col gap-8 items-center w-full">
        Follow someone to see content from them
        {myPubKey && <PublicKeyQRCodeButton publicKey={myPubKey} />}
      </div>
    </div>
  ) : null

function HomeFeed() {
  const containerRef = useRef<HTMLDivElement>(null)
  const myPubKey = usePublicKey()
  const follows = useFollows(myPubKey, true) // to update on follows change
  const navItemClicked = useUIStore((state) => state.navItemClicked)
  const {
    activeFeed,
    setActiveFeed,
    getAllFeedConfigs,
    loadFeedConfig,
    deleteFeed,
    cloneFeed,
    resetAllFeedsToDefaults,
    triggerFeedRefresh,
  } = useFeedStore()
  const feedRefreshSignal = useFeedStore((state) => state.feedRefreshSignal)
  const enabledFeedIds = useEnabledFeedIds()
  const feedConfigs = useFeedConfigs()
  const socialGraphLoaded = useSocialGraphLoaded()
  const [editMode, setEditMode] = useState(false)

  // Handle home nav click - trigger refresh (NavLink already checked if at top)
  useEffect(() => {
    if (navItemClicked.signal === 0 || navItemClicked.path !== "/") return

    // NavLink only sends signal when already at top, so just trigger refresh
    triggerFeedRefresh()
  }, [navItemClicked, triggerFeedRefresh])

  // Get all feed configs from store
  const allFeeds = useMemo(() => {
    return getAllFeedConfigs()
  }, [feedConfigs, enabledFeedIds])

  // Filter and order feeds based on enabled feed IDs from store
  const feeds = useMemo(() => {
    const feedsMap = new Map(allFeeds.map((feed) => [feed.id, feed]))
    return enabledFeedIds
      .map((id) => feedsMap.get(id))
      .filter((feed): feed is FeedConfig => feed !== undefined)
  }, [allFeeds, enabledFeedIds])

  const activeFeedConfig = useMemo(
    () => loadFeedConfig(activeFeed),
    [loadFeedConfig, activeFeed, feedConfigs]
  )

  // Editor handler functions
  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const handleDeleteFeed = async (feedId: string) => {
    if (feeds.length <= 1) {
      return // Don't allow deleting the last feed
    }

    const getDisplayName = (feedId: string, defaultName: string) => {
      const config = loadFeedConfig(feedId)
      return config?.customName || defaultName
    }

    if (
      await confirm(
        `Delete feed "${getDisplayName(feedId, allFeeds.find((f) => f.id === feedId)?.name || "")}"?`
      )
    ) {
      // If deleting the active feed, switch to the first remaining feed
      if (feedId === activeFeed) {
        const remainingFeeds = feeds.filter((f) => f.id !== feedId)
        if (remainingFeeds.length > 0) {
          setActiveFeed(remainingFeeds[0].id)
        }
      }

      deleteFeed(feedId)
    }
  }

  const handleResetFeeds = async () => {
    if (await confirm("Reset all feeds to defaults?")) {
      setEditMode(false)
      resetAllFeedsToDefaults()
    }
  }

  const handleCloneFeed = (feedId: string) => {
    cloneFeed(feedId)
  }

  // Create a comprehensive key that changes when any relevant config changes
  const feedKey = useMemo(() => {
    if (!activeFeedConfig) return "feed-null"
    return `feed-${getFeedCacheKey(activeFeedConfig)}`
  }, [activeFeedConfig])

  if (!activeFeedConfig?.filter && !activeFeedConfig?.feedStrategy) {
    return null
  }

  if (!socialGraphLoaded) {
    return null
  }

  return (
    <div ref={containerRef}>
      {follows.length > 1 && myPubKey && (
        <FeedTabs
          allTabs={allFeeds}
          editMode={editMode}
          onEditModeToggle={toggleEditMode}
        />
      )}
      {editMode && follows.length > 1 && myPubKey && activeFeedConfig?.feedStrategy && (
        <div className="mt-4 p-4 border border-base-300 rounded-lg bg-base-50">
          <div className="text-sm text-base-content/50 italic">
            {activeFeedConfig.feedStrategy === "popular"
              ? "Popular feeds use a fixed algorithm to calculate the most popular posts first."
              : "For You feeds use personalized algorithms to curate content based on your interests."}{" "}
            Editing functionality is under construction.
          </div>
        </div>
      )}
      {editMode && follows.length > 1 && myPubKey && !activeFeedConfig?.feedStrategy && (
        <StoredFeedEditor
          key={activeFeed}
          activeTab={activeFeed}
          tabs={feeds}
          onEditModeToggle={toggleEditMode}
          onDeleteFeed={handleDeleteFeed}
          onResetFeeds={handleResetFeeds}
          onCloneFeed={handleCloneFeed}
        />
      )}
      <NotificationPrompt />
      <div>
        {myPubKey && (
          <div className="hidden md:block">
            <InlineNoteCreator
              onPublish={() => triggerFeedRefresh()}
              placeholder="What's on your mind?"
            />
          </div>
        )}
        {(() => {
          if (!myPubKey) return <AlgorithmicFeed type="popular" />

          if (activeFeedConfig?.feedStrategy)
            return (
              <AlgorithmicFeed
                key={`${activeFeedConfig.feedStrategy}-${feedRefreshSignal}`}
                type={activeFeedConfig.feedStrategy}
              />
            )

          return (
            <Feed
              key={feedKey}
              feedConfig={activeFeedConfig}
              showDisplayAsSelector={follows.length > 1}
              forceUpdate={0}
              emptyPlaceholder={""}
            />
          )
        })()}
        {follows.length <= 1 && myPubKey && (
          <>
            <NoFollows myPubKey={myPubKey} />
            {!activeFeedConfig?.feedStrategy && (
              <AlgorithmicFeed
                type="popular"
                displayOptions={{showDisplaySelector: false}}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default HomeFeed
