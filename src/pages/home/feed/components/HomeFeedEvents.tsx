import {useCallback, useMemo, useEffect} from "react"
import {NostrEvent, Filter} from "nostr-tools"

import PublicKeyQRCodeButton from "@/shared/components/user/PublicKeyQRCodeButton"
import NotificationPrompt from "@/shared/components/NotificationPrompt"
import PopularFeed from "@/shared/components/feed/PopularFeed"
import {useRefreshRouteSignal} from "@/stores/notifications"
import {seenEventIds, feedCache} from "@/utils/memcache"
import Header from "@/shared/components/header/Header"
import Feed from "@/shared/components/feed/Feed.tsx"
import {hasMedia} from "@/shared/components/embed"
import useFollows from "@/shared/hooks/useFollows"
import {getEventReplyingTo} from "@/utils/nostr"
import {useSocialGraphLoaded} from "@/utils/socialGraph"
import {usePublicKey} from "@/stores/user"
import {
  useFeedStore,
  useEnabledFeedIds,
  useTabConfigs,
  type TabConfig,
} from "@/stores/feed"
import FeedTabs, {type FeedTab} from "@/shared/components/feed/FeedTabs"

const NoFollows = ({myPubKey}: {myPubKey?: string}) =>
  myPubKey ? (
    <div className="flex flex-col gap-8 items-center justify-center text-base-content/50">
      <div className="px-4 py-8 border-b border-base-300 flex flex-col gap-8 items-center w-full">
        Follow someone to see content from them
        {myPubKey && <PublicKeyQRCodeButton publicKey={myPubKey} />}
      </div>
    </div>
  ) : null

// Convert store config to FeedTab format with filter functions
const createFeedTabFromConfig = (config: TabConfig): FeedTab => {
  const tab: FeedTab = {
    name: config.name,
    id: config.id,
    showRepliedTo: config.showRepliedTo,
    sortLikedPosts: config.sortLikedPosts,
  }

  // Add filter if exists
  if (config.filter) {
    tab.filter = config.filter
  }

  // Create fetchFilterFn based on config
  if (config.excludeSeen || config.hideReplies) {
    tab.fetchFilterFn = (e: NostrEvent) => {
      // Check if should exclude seen events
      if (config.excludeSeen && seenEventIds.has(e.id)) {
        return false
      }

      // Check reply exclusion
      if (config.hideReplies && getEventReplyingTo(e)) {
        return false
      }

      return true
    }
  }

  // Create displayFilterFn based on config
  if (config.requiresMedia || config.requiresReplies || config.hideReplies) {
    tab.displayFilterFn = (e: NostrEvent) => {
      // Check if requires media
      if (config.requiresMedia && !hasMedia(e)) {
        return false
      }

      // Check if requires replies
      if (config.requiresReplies && !getEventReplyingTo(e)) {
        return false
      }

      // Check reply exclusion for display
      if (config.hideReplies && getEventReplyingTo(e)) {
        return false
      }

      return true
    }
  }

  return tab
}

function HomeFeedEvents() {
  const myPubKey = usePublicKey()
  const follows = useFollows(myPubKey, true) // to update on follows change
  const refreshSignal = useRefreshRouteSignal()
  const {activeHomeTab: activeTab, getAllFeedConfigs, loadFeedConfig} = useFeedStore()
  const enabledFeedIds = useEnabledFeedIds()
  const tabConfigs = useTabConfigs()
  const socialGraphLoaded = useSocialGraphLoaded()

  // Convert store configs to FeedTab format
  const allTabs: FeedTab[] = useMemo(() => {
    const configs = getAllFeedConfigs()
    return configs.map((config) => createFeedTabFromConfig(config))
  }, [getAllFeedConfigs, tabConfigs, activeTab])

  // Filter and order tabs based on enabled feed IDs from store
  const tabs = useMemo(() => {
    const tabsMap = new Map(allTabs.map((tab) => [tab.id, tab]))
    return enabledFeedIds
      .map((id) => tabsMap.get(id))
      .filter((tab): tab is FeedTab => tab !== undefined)
  }, [allTabs, enabledFeedIds])

  const activeTabItem = useMemo(
    () => tabs.find((t) => t.id === activeTab) || tabs[0] || null,
    [activeTab, tabs]
  )

  const activeTabConfig = useMemo(
    () => loadFeedConfig(activeTab),
    [loadFeedConfig, activeTab]
  )

  const openedAt = useMemo(() => Date.now(), [])

  useEffect(() => {
    if (activeTab !== "unseen") {
      feedCache.delete("unseen")
    }
    if (activeTab === "unseen" && refreshSignal > openedAt) {
      feedCache.delete("unseen")
    }
  }, [activeTabItem, openedAt, refreshSignal, activeTab])

  // Create a comprehensive key that changes when any relevant config changes
  const feedKey = useMemo(() => {
    return `feed-${JSON.stringify(activeTabConfig)}`
  }, [activeTab, activeTabConfig])

  const displayFilterFn = useCallback(
    (event: NostrEvent) => {
      if (
        activeTab === "unseen" &&
        refreshSignal > openedAt &&
        seenEventIds.has(event.id)
      ) {
        return false
      }

      const tabFilter = activeTabItem?.displayFilterFn
      return tabFilter ? tabFilter(event) : true
    },
    [activeTabItem, activeTab, refreshSignal, openedAt]
  )

  if (!activeTabConfig?.filter) {
    return null
  }

  const feedName =
    follows.length <= 1
      ? "Home"
      : activeTabConfig?.customName || activeTabItem?.name || "Following"

  return (
    <>
      <Header showBack={false}>
        <span className="md:px-3 md:py-2">{feedName}</span>
      </Header>
      {follows.length > 1 && myPubKey && <FeedTabs allTabs={allTabs} />}
      <NotificationPrompt />
      <Feed
        key={feedKey}
        filters={activeTabConfig.filter as unknown as Filter}
        displayFilterFn={displayFilterFn}
        fetchFilterFn={activeTabItem?.fetchFilterFn}
        showDisplayAsSelector={follows.length > 1}
        cacheKey={`${activeTabItem?.id || activeTab}-${activeTabConfig?.filter?.search || ""}`}
        showRepliedTo={
          activeTabConfig?.showRepliedTo ?? activeTabItem?.showRepliedTo ?? true
        }
        forceUpdate={0}
        sortLikedPosts={activeTabItem?.sortLikedPosts}
        emptyPlaceholder={""}
        showEventsByUnknownUsers={activeTabConfig?.showEventsByUnknownUsers ?? false}
        followDistance={activeTabConfig?.followDistance}
        {...(activeTabConfig?.relayUrls && {relayUrls: activeTabConfig.relayUrls})}
      />
      {socialGraphLoaded && follows.length <= 1 && (
        <>
          <NoFollows myPubKey={myPubKey} />
          <PopularFeed small={false} days={7} />
        </>
      )}
    </>
  )
}

export default HomeFeedEvents
