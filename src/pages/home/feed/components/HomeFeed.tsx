import {useMemo, useState, useEffect, useRef} from "react"

import PublicKeyQRCodeButton from "@/shared/components/user/PublicKeyQRCodeButton"
import NotificationPrompt from "@/shared/components/NotificationPrompt"
import AlgorithmicFeed from "@/shared/components/feed/AlgorithmicFeed"
import Feed from "@/shared/components/feed/Feed.tsx"
import {useFollowsFromGraph} from "@/utils/socialGraph"
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
  // Use reactive hook - renders immediately with empty array, updates when graph loads
  const follows = useFollowsFromGraph(myPubKey, true)

  // Track if we've seen follows data (graph has loaded with data)
  const followsRef = useRef<number | null>(null)
  const [followsInitialized, setFollowsInitialized] = useState(follows.length > 0)

  useEffect(() => {
    if (followsInitialized) return
    if (followsRef.current === null) {
      followsRef.current = follows.length
      if (follows.length > 0) {
        setFollowsInitialized(true)
      }
      return
    }
    // Once follows stabilize or change, we've loaded
    if (followsRef.current !== follows.length || follows.length > 0) {
      setFollowsInitialized(true)
    }
  }, [follows.length, followsInitialized])

  const showNoFollows = followsInitialized && follows.length <= 1

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
        <div className="flex flex-col gap-4 mt-4 p-4 border border-base-300 rounded-lg">
          <div className="flex justify-between items-center">
            <div className="text-lg font-semibold">
              Edit &quot;{activeFeedConfig.customName || activeFeedConfig.name}&quot;
            </div>
          </div>
          <div className="text-sm text-base-content/50 italic mb-2">
            {activeFeedConfig.feedStrategy === "popular"
              ? "Popular feeds use a fixed algorithm to calculate the most popular posts first."
              : "For You feeds use personalized algorithms to curate content based on your interests."}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={activeFeedConfig.showZapAll ?? false}
              onChange={(e) => {
                const {saveFeedConfig} = useFeedStore.getState()
                saveFeedConfig(activeFeed, {showZapAll: e.target.checked})
              }}
              className="checkbox checkbox-sm"
            />
            <span className="text-sm text-base-content/70">
              Always show &quot;zap all&quot;
            </span>
          </label>
          <div className="flex justify-between gap-2 pt-2 border-t border-base-300">
            <button onClick={toggleEditMode} className="btn btn-sm btn-primary">
              Done
            </button>
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
        {showNoFollows && myPubKey && !activeFeedConfig?.feedStrategy && (
          <NoFollows myPubKey={myPubKey} />
        )}
        {(() => {
          if (!myPubKey) return <AlgorithmicFeed type="popular" />

          if (activeFeedConfig?.feedStrategy)
            return (
              <AlgorithmicFeed
                key={`${activeFeedConfig.feedStrategy}-${feedRefreshSignal}`}
                type={activeFeedConfig.feedStrategy}
                forceShowZapAll={editMode}
                showZapAll={activeFeedConfig.showZapAll}
              />
            )

          return (
            <Feed
              key={feedKey}
              feedConfig={activeFeedConfig}
              showDisplayAsSelector={follows.length > 1}
              forceUpdate={0}
              emptyPlaceholder={""}
              forceShowZapAll={editMode}
            />
          )
        })()}
        {follows.length <= 1 && myPubKey && !activeFeedConfig?.feedStrategy && (
          <AlgorithmicFeed type="popular" displayOptions={{showDisplaySelector: false}} />
        )}
      </div>
    </div>
  )
}

export default HomeFeed
