import {useCallback, useMemo, useEffect, useState} from "react"
import {NDKEvent} from "@nostr-dev-kit/ndk"

import PublicKeyQRCodeButton from "@/shared/components/user/PublicKeyQRCodeButton"
import NotificationPrompt from "@/shared/components/NotificationPrompt"
import Trending from "@/shared/components/feed/Trending.tsx"
import useHistoryState from "@/shared/hooks/useHistoryState"
import {useLocalState} from "irisdb-hooks/src/useLocalState"
import {seenEventIds, feedCache} from "@/utils/memcache"
import Header from "@/shared/components/header/Header"
import Feed from "@/shared/components/feed/Feed.tsx"
import {hasMedia} from "@/shared/components/embed"
import useFollows from "@/shared/hooks/useFollows"
import {getEventReplyingTo} from "@/utils/nostr"
import socialGraph from "@/utils/socialGraph"
import {localState} from "irisdb/src"

const UNSEEN_CACHE_KEY = "unseenFeed"

let myPubKey = ""
localState.get("user/publicKey").on((v) => (myPubKey = v || ""), false, undefined, String)

const EmptyPlaceholder = ({follows, myPubKey}: {follows: string[]; myPubKey?: string}) =>
  myPubKey ? (
    <div className="flex flex-col gap-8 items-center justify-center text-base-content/50">
      <div className="px-4 py-8 border-b border-base-300 flex flex-col gap-8 items-center w-full">
        {follows.length <= 1 ? "Follow someone to see content from them" : "No posts yet"}
        {myPubKey && follows.length <= 1 && (
          <PublicKeyQRCodeButton publicKey={myPubKey} />
        )}
      </div>
      Popular posts
    </div>
  ) : null

function HomeFeedEvents() {
  const follows = useFollows(myPubKey, true) // to update on follows change
  useLocalState("user/publicKey", "") // update on login
  const [refreshSignal] = useLocalState("refreshRouteSignal", 0, Number) // update on login
  const [activeTab, setActiveTab] = useHistoryState("unseen", "activeHomeTab")
  const [forceUpdate, setForceUpdate] = useState(0)

  const tabs = useMemo(
    () => [
      {
        name: "Unseen",
        path: "unseen",
        cacheKey: UNSEEN_CACHE_KEY,
        showRepliedTo: false,
        fetchFilterFn: (e: NDKEvent) => !getEventReplyingTo(e) && !seenEventIds.has(e.id),
      },
      {
        name: "Popular",
        path: "popular",
        filter: {
          kinds: [6, 7],
          since: Math.floor(Date.now() / 1000 - 60 * 60 * 24),
          limit: 200,
          authors: follows,
        },
        cacheKey: "popularFeed",
        sortLikedPosts: true,
      },
      {
        name: "Latest",
        path: "latest",
        showRepliedTo: false,
        displayFilterFn: (e: NDKEvent) =>
          !getEventReplyingTo(e) && socialGraph().getFollowDistance(e.pubkey) <= 1,
      },
      {
        name: "Replies",
        path: "replies",
        displayFilterFn: (e: NDKEvent) => socialGraph().getFollowDistance(e.pubkey) <= 1,
      },
      {
        name: "Media",
        path: "media",
        showRepliedTo: false,
        displayFilterFn: (e: NDKEvent) => hasMedia(e),
      },
      {
        name: "Adventure",
        path: "adventure",
        showRepliedTo: false,
        filter: {
          kinds: [1],
          limit: 100,
        },
        fetchFilterFn: (e: NDKEvent) =>
          !getEventReplyingTo(e) && socialGraph().getFollowDistance(e.pubkey) <= 5,
      },
    ],
    [follows]
  )

  const activeTabItem = useMemo(
    () => tabs.find((t) => t.path === activeTab) || tabs[0],
    [activeTab, tabs]
  )

  const openedAt = useMemo(() => Date.now(), [])

  useEffect(() => {
    if (activeTab !== "unseen") {
      feedCache.delete(UNSEEN_CACHE_KEY)
    }
    if (activeTab === "unseen" && refreshSignal > openedAt) {
      const cachedFeed = feedCache.get(UNSEEN_CACHE_KEY)
      if (cachedFeed) {
        for (const [eventId, event] of cachedFeed) {
          if (seenEventIds.has(event.id) || !activeTabItem.fetchFilterFn?.(event)) {
            cachedFeed.delete(eventId)
          }
        }
        setForceUpdate((prev) => prev + 1) // Force update Feed component
      }
    }
  }, [activeTabItem, openedAt, refreshSignal, activeTab])

  const filters = useMemo(() => {
    if (activeTabItem.filter) {
      return activeTabItem.filter
    }

    return {
      authors: follows,
      kinds: [1, 6],
      limit: 100,
    }
  }, [follows, activeTabItem])

  const displayFilterFn = useCallback(
    (event: NDKEvent) => {
      if (activeTab === "unseen" && seenEventIds.has(event.id)) {
        return false
      }
      const tabFilter = activeTabItem.displayFilterFn
      return tabFilter ? tabFilter(event) : true
    },
    [activeTabItem, activeTab]
  )

  const feedName =
    follows.length <= 1
      ? "Home"
      : tabs.find((t) => t.path === activeTab)?.name || "Following"

  return (
    <>
      <Header showBack={false}>
        <span className="md:px-3 md:py-2">{feedName}</span>
      </Header>
      {follows.length > 1 && myPubKey && (
        <div className="px-4 pb-4 flex flex-row gap-2 overflow-x-auto max-w-[100vw] scrollbar-hide">
          {tabs.map((t) => (
            <button
              key={t.path}
              className={`btn btn-sm ${activeTab === t.path ? "btn-primary" : "btn-neutral"}`}
              onClick={() => setActiveTab(t.path)}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
      <NotificationPrompt />
      <Feed
        key={activeTab === "unseen" ? "unseen" : "other"}
        filters={filters}
        displayFilterFn={displayFilterFn}
        fetchFilterFn={activeTabItem.fetchFilterFn}
        cacheKey={activeTabItem.cacheKey}
        showRepliedTo={activeTabItem.showRepliedTo}
        emptyPlaceholder={<EmptyPlaceholder follows={follows} myPubKey={myPubKey} />}
        forceUpdate={forceUpdate}
        sortLikedPosts={activeTabItem.sortLikedPosts}
      />
      {follows.length <= 1 && <Trending small={false} contentType="images" />}
    </>
  )
}

export default HomeFeedEvents
