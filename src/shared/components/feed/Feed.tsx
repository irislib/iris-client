import {useRef, useState, ReactNode, useEffect, useMemo, memo} from "react"
import {NostrEvent, Filter} from "nostr-tools"

import InfiniteScroll from "@/shared/components/ui/InfiniteScroll"
import useHistoryState from "@/shared/hooks/useHistoryState"
import FeedItem from "../event/FeedItem/FeedItem"
import {useUserStore} from "@/stores/user"

import {INITIAL_DISPLAY_COUNT, DISPLAY_INCREMENT} from "./utils"
import useFeedEvents from "@/shared/hooks/useFeedEvents.ts"
import {useSocialGraphLoaded} from "@/utils/socialGraph.ts"
import UnknownUserEvents from "./UnknownUserEvents.tsx"
import {DisplayAsSelector} from "./DisplayAsSelector"
import NewEventsButton from "./NewEventsButton.tsx"
import {useFeedStore} from "@/stores/feed"
import {getTag} from "@/utils/nostr"
import MediaFeed from "./MediaFeed"
import socialGraph from "@/utils/socialGraph"

interface FeedProps {
  filters: Filter
  displayFilterFn?: (event: NostrEvent) => boolean
  fetchFilterFn?: (event: NostrEvent) => boolean
  sortFn?: (a: NostrEvent, b: NostrEvent) => number
  cacheKey?: string
  asReply?: boolean
  showRepliedTo?: boolean
  showReplies?: number
  onEvent?: (event: NostrEvent) => void
  borderTopFirst?: boolean
  emptyPlaceholder?: ReactNode
  forceUpdate?: number
  displayAs?: "list" | "grid"
  showDisplayAsSelector?: boolean
  onDisplayAsChange?: (display: "list" | "grid") => void
  sortLikedPosts?: boolean
  relayUrls?: string[]
  showEventsByUnknownUsers?: boolean
  followDistance?: number
}

const DefaultEmptyPlaceholder = (
  <div className="p-8 flex flex-col gap-8 items-center justify-center text-base-content/50">
    No posts yet
  </div>
)

const Feed = memo(function Feed({
  filters,
  displayFilterFn,
  fetchFilterFn,
  sortFn,
  cacheKey = JSON.stringify({...filters, isTruncated: true}),
  asReply = false,
  showRepliedTo = true,
  showReplies = 0,
  onEvent,
  borderTopFirst = true,
  emptyPlaceholder = DefaultEmptyPlaceholder,
  forceUpdate,
  displayAs: initialDisplayAs = "list",
  showDisplayAsSelector = true,
  onDisplayAsChange,
  sortLikedPosts = false,
  relayUrls,
  showEventsByUnknownUsers: showEventsByUnknownUsersProp = false,
  followDistance,
}: FeedProps) {
  const [displayCount, setDisplayCount] = useHistoryState(
    INITIAL_DISPLAY_COUNT,
    "displayCount"
  )
  const firstFeedItemRef = useRef<HTMLDivElement>(null)
  const myPubKey = useUserStore((state) => state.publicKey)

  const [showEventsByUnknownUsers, setShowEventsByUnknownUsers] = useState(false)

  // Create combined display filter that includes follow distance filtering if needed
  const combinedDisplayFilterFn = useMemo(() => {
    // Simple relay URL normalization (temporarily unused)
    // const normalizeRelay = (url: string) =>
    //   url.replace(/^(https?:\/\/)?(wss?:\/\/)?/, "").replace(/\/$/, "")

    return (event: NostrEvent) => {
      // First apply custom display filter if provided
      if (displayFilterFn && !displayFilterFn(event)) {
        return false
      }

      // Apply relay filtering if relayUrls is configured
      // TODO: Implement relay filtering with applesauce - NDK onRelays property not available
      // if (relayUrls && relayUrls.length > 0) {
      //   if (!event.onRelays || event.onRelays.length === 0) return false
      //
      //   const normalizedTargetRelays = relayUrls.map(normalizeRelay)
      //   const eventIsOnTargetRelay = event.onRelays.some((relay) =>
      //     normalizedTargetRelays.includes(normalizeRelay(relay.url))
      //   )
      //
      //   if (!eventIsOnTargetRelay) return false
      // }

      // Apply follow distance filter if specified and showEventsByUnknownUsers is false
      if (followDistance !== undefined && !showEventsByUnknownUsersProp) {
        const eventFollowDistance = socialGraph().getFollowDistance(event.pubkey)
        if (eventFollowDistance > followDistance) {
          return false
        }
      }

      return true
    }
  }, [displayFilterFn, followDistance, showEventsByUnknownUsersProp, relayUrls])

  const {feedDisplayAs: persistedDisplayAs, setFeedDisplayAs} = useFeedStore()

  // Use persisted value only when selector is shown, otherwise use initialDisplayAs
  const displayAs = showDisplayAsSelector ? persistedDisplayAs : initialDisplayAs
  const setDisplayAs = (value: "list" | "grid") => {
    setFeedDisplayAs(value)
  }

  const {
    newEvents: newEventsMap,
    filteredEvents,
    eventsByUnknownUsers,
    showNewEvents,
    loadMoreItems: hookLoadMoreItems,
    initialLoadDone,
  } = useFeedEvents({
    filters,
    cacheKey,
    displayCount,
    displayFilterFn: combinedDisplayFilterFn,
    fetchFilterFn,
    sortFn,
    hideEventsByUnknownUsers: !showEventsByUnknownUsersProp,
    sortLikedPosts,
    relayUrls,
  })

  const loadMoreItems = () => {
    const hasMore = hookLoadMoreItems()
    if (hasMore) {
      setDisplayCount((prev: number) => prev + DISPLAY_INCREMENT)
    }
    return hasMore
  }

  const newEventsFiltered = useMemo(() => {
    return Array.from(newEventsMap.values()).filter(combinedDisplayFilterFn)
  }, [newEventsMap, combinedDisplayFilterFn])

  const newEventsFromFiltered = useMemo(() => {
    return new Set(newEventsFiltered.map((event) => event.pubkey))
  }, [newEventsFiltered])

  const gridEvents = useMemo(() => {
    if (displayAs === "grid") {
      return filteredEvents
        .map((event) => {
          if ("content" in event && event.kind === 7) {
            const eTag = getTag("e", event.tags)
            return eTag ? {id: eTag} : null
          }
          return event
        })
        .filter((event) => event !== null)
    }
    return filteredEvents
  }, [filteredEvents, displayAs])

  const [, setForceUpdateCount] = useState(0)

  const isSocialGraphLoaded = useSocialGraphLoaded()

  useEffect(() => {
    if (forceUpdate !== undefined) {
      setForceUpdateCount((prev) => prev + 1)
    }
  }, [forceUpdate])

  if (!isSocialGraphLoaded) {
    return null
  }

  return (
    <>
      {showDisplayAsSelector && (
        <DisplayAsSelector
          activeSelection={displayAs}
          onSelect={(display) => {
            setDisplayAs(display)
            onDisplayAsChange?.(display)
          }}
        />
      )}

      {newEventsFiltered.length > 0 && (
        <NewEventsButton
          newEventsFiltered={newEventsFiltered}
          newEventsFrom={newEventsFromFiltered}
          showNewEvents={showNewEvents}
          firstFeedItemRef={firstFeedItemRef}
        />
      )}

      <div>
        {filteredEvents.length > 0 && (
          <InfiniteScroll onLoadMore={loadMoreItems}>
            {displayAs === "grid" ? (
              <MediaFeed events={gridEvents} />
            ) : (
              <>
                {filteredEvents.slice(0, displayCount).map((event, index) => (
                  <div key={event.id} ref={index === 0 ? firstFeedItemRef : null}>
                    <FeedItem
                      key={event.id}
                      asReply={asReply}
                      showRepliedTo={showRepliedTo}
                      showReplies={showReplies}
                      event={"content" in event ? event : undefined}
                      eventId={"content" in event ? undefined : event.id}
                      onEvent={onEvent}
                      borderTop={borderTopFirst && index === 0}
                    />
                  </div>
                ))}
              </>
            )}
          </InfiniteScroll>
        )}
        {filteredEvents.length === 0 &&
          newEventsFiltered.length === 0 &&
          initialLoadDone &&
          emptyPlaceholder}
        {myPubKey && eventsByUnknownUsers.length > 0 && (
          <div
            className="p-4 border-t border-b border-custom text-info text-center transition-colors duration-200 ease-in-out hover:underline hover:bg-[var(--note-hover-color)] cursor-pointer"
            onClick={() => setShowEventsByUnknownUsers(!showEventsByUnknownUsers)}
          >
            {showEventsByUnknownUsers ? "Hide" : "Show"} {eventsByUnknownUsers.length}{" "}
            events by unknown users
          </div>
        )}
        {showEventsByUnknownUsers && eventsByUnknownUsers.length > 0 && (
          <UnknownUserEvents
            eventsByUnknownUsers={eventsByUnknownUsers}
            showRepliedTo={showRepliedTo}
            asReply={true}
          />
        )}
      </div>
    </>
  )
})

export default Feed
