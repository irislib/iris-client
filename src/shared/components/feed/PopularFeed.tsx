import {useCallback, useMemo, useState} from "react"
import {NostrEvent} from "nostr-tools"
import classNames from "classnames"

import socialGraph, {
  DEFAULT_SOCIAL_GRAPH_ROOT,
  useSocialGraphLoaded,
} from "@/utils/socialGraph"
import EventBorderless from "@/shared/components/event/EventBorderless"
import InfiniteScroll from "@/shared/components/ui/InfiniteScroll"
import useFeedEvents from "@/shared/hooks/useFeedEvents"
import useFollows from "@/shared/hooks/useFollows"
import {useUserStore} from "@/stores/user"
import Feed from "./Feed"

export default function PopularFeed({
  small = true,
  randomSort = true,
  days = 1,
}: {
  small?: boolean
  randomSort?: boolean
  days?: number
}) {
  const isSocialGraphLoaded = useSocialGraphLoaded()
  const [displayCount, setDisplayCount] = useState(10)
  const myPubKey = useUserStore((state) => state.publicKey)
  const myFollows = useFollows(myPubKey, false)

  // Determine if we should use fallback to DEFAULT_SOCIAL_GRAPH_ROOT
  const shouldUseFallback = myFollows.length === 0

  // Get authors for the query - either from user's follows or DEFAULT_SOCIAL_GRAPH_ROOT's follows
  const authors = useMemo(() => {
    if (shouldUseFallback) {
      const follows = Array.from(
        socialGraph().getFollowedByUser(DEFAULT_SOCIAL_GRAPH_ROOT)
      )
      return follows
    }
    return myFollows
  }, [shouldUseFallback, myFollows])

  // Create filters for popular feed - fetch likes/reactions from specified days
  const filters = useMemo(
    () => ({
      kinds: [6, 7], // Like and reaction events only
      since: Math.floor(Date.now() / 1000 - 60 * 60 * 24 * days), // Last N days
      authors: authors.length > 0 ? authors : undefined,
      limit: 300,
    }),
    [authors, days]
  )

  // Social graph filter - only show posts from users within distance 2 (unless using fallback)
  const displayFilterFn = useCallback(
    (e: NostrEvent) => {
      if (shouldUseFallback) {
        return true
      }
      return socialGraph().getFollowDistance(e.pubkey) <= 2
    },
    [shouldUseFallback]
  )

  // Always call hooks - use different logic based on small prop
  const {filteredEvents: rawFilteredEvents, initialLoadDone} = useFeedEvents({
    filters,
    cacheKey: "popularFeed",
    displayCount: small ? displayCount * 2 : displayCount,
    displayFilterFn,
    fetchFilterFn: undefined,
    hideEventsByUnknownUsers: false,
    sortLikedPosts: !small, // Let Feed handle sorting when not small
  })

  // Custom sorting logic for small display (preserves reaction counts and randomization)
  const customSortedEvents = useMemo(() => {
    if (!small || !rawFilteredEvents) return []

    const likesByPostId = new Map<string, number>()
    rawFilteredEvents.forEach((event) => {
      if ("tags" in event) {
        const postId = event.tags?.find((t: string[]) => t[0] === "e")?.[1]
        if (postId) {
          likesByPostId.set(postId, (likesByPostId.get(postId) || 0) + 1)
        }
      }
    })

    const sortedEntries = Array.from(likesByPostId.entries()).sort(
      ([, likesA], [, likesB]) => likesB - likesA
    )

    // For random sort, apply minimum reaction filter if we have enough events
    if (randomSort) {
      const qualifyingEvents = sortedEntries.filter(([, likes]) => likes >= 2)
      const eventsToUse = qualifyingEvents.length >= 5 ? qualifyingEvents : sortedEntries
      const events = eventsToUse.map(([postId, likes]) => ({id: postId, likes}))
      return [...events].sort(() => Math.random() - 0.5)
    }

    return sortedEntries.map(([postId, likes]) => ({id: postId, likes}))
  }, [rawFilteredEvents, randomSort, small])

  const loadMore = useCallback(() => {
    setDisplayCount((prevCount) => Math.min(prevCount + 10, customSortedEvents.length))
  }, [customSortedEvents.length])

  const isTestEnvironment =
    typeof window !== "undefined" && window.location.href.includes("localhost:5173")
  if (!isSocialGraphLoaded && !isTestEnvironment) {
    return null
  }

  const emptyPlaceholder = <div className="px-4">No popular posts found</div>

  // For small displays, use EventBorderless with custom sorting
  if (small) {
    return (
      <InfiniteScroll onLoadMore={loadMore}>
        <div
          className={classNames("flex flex-col gap-4", {
            "text-base-content/50": small,
          })}
        >
          {initialLoadDone && customSortedEvents.length === 0 ? emptyPlaceholder : null}
          {customSortedEvents.slice(0, displayCount).map((event) => {
            if (!event || !event.id) return null
            return <EventBorderless key={event.id} eventId={event.id} />
          })}
        </div>
      </InfiniteScroll>
    )
  }

  // For large displays, use the Feed component
  return (
    <Feed
      filters={filters}
      displayFilterFn={displayFilterFn}
      cacheKey="popularFeed"
      sortLikedPosts={true}
      showDisplayAsSelector={true}
      emptyPlaceholder={emptyPlaceholder}
      displayAs="list"
      asReply={false}
      borderTopFirst={true}
    />
  )
}
