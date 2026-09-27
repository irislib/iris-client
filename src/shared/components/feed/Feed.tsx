import {useGroupAccess, useGroupVisibility} from "@/groups/GroupContext"
import {useRef, useState, ReactNode, useEffect, useMemo, memo, useCallback} from "react"
import {NDKEvent, NDKFilter} from "@/lib/ndk"

import {useGroupEvents} from "@/groups/useGroupEvents"
import {groupTags} from "@/groups/model"
import {ndk} from "@/utils/ndk"
import {getEventReplyReference} from "@/utils/threadReferences"
import {PerfProfiler} from "@/utils/reactProfiler"
import InfiniteScroll from "@/shared/components/ui/InfiniteScroll"
import useHistoryState from "@/shared/hooks/useHistoryState"
import FeedItem from "../event/FeedItem/FeedItem"
import {useUserStore} from "@/stores/user"

import {INITIAL_DISPLAY_COUNT, DISPLAY_INCREMENT} from "./utils"
import useFeedEvents from "@/shared/hooks/useFeedEvents.ts"
import UnknownUserEvents from "./UnknownUserEvents.tsx"
import {DisplayAsSelector} from "./DisplayAsSelector"
import NewEventsButton from "./NewEventsButton.tsx"
import ZapAllButton from "./ZapAllButton"
import {useFeedStore, type FeedConfig, getFeedCacheKey} from "@/stores/feed"
import {getTag} from "@/utils/nostr"
import MediaFeed from "./MediaFeed"
import {useSocialGraph, useFollowsFromGraph} from "@/utils/socialGraph"
import {addSeenEventId} from "@/utils/memcache.ts"
import type {AlgorithmicVisibilitySnapshot} from "@/utils/visibility"

interface FeedProps {
  feedConfig: FeedConfig
  asReply?: boolean
  showReplies?: number
  onEvent?: (event: NDKEvent) => void
  borderTopFirst?: boolean
  emptyPlaceholder?: ReactNode
  forceUpdate?: number
  displayAs?: "list" | "grid"
  showDisplayAsSelector?: boolean
  onDisplayAsChange?: (display: "list" | "grid") => void
  forceShowZapAll?: boolean
  subscriptionFilters?: NDKFilter[]
  injectedEvents?: NDKEvent[]
  visibilitySnapshot?: AlgorithmicVisibilitySnapshot | null
  enabled?: boolean
  eventSource?: {events: NDKEvent[]; loading: boolean}
  selectEvents?: (events: readonly NDKEvent[], displayCount: number) => NDKEvent[]
}

const DefaultEmptyPlaceholder = (
  <div className="p-8 flex flex-col gap-8 items-center justify-center text-base-content/50">
    No posts yet
  </div>
)

const Feed = memo(function Feed({
  feedConfig,
  asReply = false,
  showReplies = 0,
  onEvent,
  borderTopFirst = true,
  emptyPlaceholder = DefaultEmptyPlaceholder,
  forceUpdate,
  displayAs: initialDisplayAs = "list",
  showDisplayAsSelector = true,
  onDisplayAsChange,
  forceShowZapAll = false,
  subscriptionFilters,
  injectedEvents,
  visibilitySnapshot: suppliedVisibilitySnapshot,
  enabled = true,
  eventSource: suppliedEventSource,
  selectEvents,
}: FeedProps) {
  const groupAccess = useGroupAccess()
  const groupVisibility = useGroupVisibility()
  const visibilitySnapshot = suppliedVisibilitySnapshot ?? groupVisibility
  const socialGraph = useSocialGraph()
  if (!feedConfig?.filter) {
    throw new Error("Feed component requires feedConfig with filter")
  }

  const myPubKey = useUserStore((state) => state.publicKey)

  // Use reactive hook - automatically updates when social graph changes
  const follows = useFollowsFromGraph(myPubKey, true)

  // Enhance filters with authors list for follow-distance-based feeds
  const filters = useMemo(() => {
    const baseFilters = feedConfig.filter as unknown as NDKFilter
    const customAuthors = baseFilters.authors || []

    // If custom authors defined, ignore followDistance and use authors as-is
    if (customAuthors.length > 0) {
      return baseFilters
    }

    // No custom authors: apply followDistance-based author filtering
    if (feedConfig.followDistance === 0 && myPubKey) {
      // followDistance 0: only our own posts
      return {
        ...baseFilters,
        authors: [myPubKey],
      }
    } else if (feedConfig.followDistance === 1 && follows.length > 0) {
      // followDistance 1: people we follow
      return {
        ...baseFilters,
        authors: follows,
      }
    }

    // followDistance > 1 or undefined: fetch all, filter client-side
    return baseFilters
  }, [feedConfig.filter, feedConfig.followDistance, follows, myPubKey])

  // Thread replies use the same member boundary and per-author query budgets.
  const groupAuthors = groupAccess
    ? [
        ...new Set([
          ...(groupAccess.membership?.authorityPubkeys ?? []),
          ...(myPubKey && groupAccess.isEligible(myPubKey) ? [myPubKey] : []),
          ...(groupAccess.membership?.eligiblePubkeys ?? []),
        ]),
      ].slice(0, 512)
    : []
  const groupFilters: NDKFilter[] =
    groupAccess && !suppliedEventSource && enabled
      ? (subscriptionFilters?.length ? subscriptionFilters : [filters]).map((filter) => ({
          ...filter,
          ...Object.fromEntries(
            groupTags(groupAccess.ref).map(([key, value]) => [`#${key}`, [value]])
          ),
          authors: groupAuthors,
        }))
      : []
  const groupEvents = useGroupEvents(
    groupAuthors.length
      ? groupFilters.flatMap((filter) =>
          groupAuthors.map((author) => ({
            ...filter,
            authors: [author],
            limit: 16,
          }))
        )
      : [],
    Math.max(1, groupAuthors.length * 32),
    {liveFilters: groupFilters, perAuthorCap: 32}
  )
  const groupSource = useMemo(() => {
    if (!groupAccess || suppliedEventSource) return undefined
    const events = new Map<string, NDKEvent>()
    for (const event of [
      ...groupEvents.events.map((raw) => new NDKEvent(ndk(), raw)),
      ...(injectedEvents ?? []),
    ]) {
      const reply = getEventReplyReference(event)
      if (
        (feedConfig.hideReplies && reply) ||
        (feedConfig.requiresReplies && !reply) ||
        (feedConfig.repliesTo && reply !== feedConfig.repliesTo)
      )
        continue
      events.set(event.id, event)
    }
    return {
      events: [...events.values()],
      loading: groupAccess.loading || groupEvents.loading,
    }
  }, [groupAccess, suppliedEventSource, groupEvents, injectedEvents, feedConfig])
  const eventSource = suppliedEventSource ?? groupSource

  const sortFn = useMemo(() => {
    switch (feedConfig.sortType) {
      case "followDistance":
        return (a: NDKEvent, b: NDKEvent) => {
          const followDistanceA = socialGraph.getFollowDistance(a.pubkey)
          const followDistanceB = socialGraph.getFollowDistance(b.pubkey)
          if (followDistanceA !== followDistanceB) {
            return followDistanceA - followDistanceB
          }
          return (a.created_at || 0) - (b.created_at || 0)
        }
      case "chronological":
        return (a: NDKEvent, b: NDKEvent) => (b.created_at || 0) - (a.created_at || 0)
      default:
        return undefined
    }
  }, [feedConfig.sortType])

  const cacheKey = useMemo(() => getFeedCacheKey(feedConfig), [feedConfig])
  const [expandedSearchAuthors, setExpandedSearchAuthors] = useState(new Set<string>())
  useEffect(() => setExpandedSearchAuthors(new Set()), [cacheKey])

  const [displayCount, setDisplayCount] = useHistoryState(
    INITIAL_DISPLAY_COUNT,
    "displayCount"
  )
  const firstFeedItemRef = useRef<HTMLDivElement>(null)
  const feedContainerRef = useRef<HTMLDivElement>(null)
  const [bottomVisibleEventTimestamp, setBottomVisibleEventTimestamp] =
    useState<number>(Infinity)

  // For manually showing/hiding unknown user events via toggle
  const [showUnknownUserEvents, setShowUnknownUserEvents] = useState(false)

  const {saveFeedConfig} = useFeedStore()

  // Local state for displayAs, initialized from feedConfig or prop
  const [displayAs, setDisplayAsState] = useState<"list" | "grid">(
    showDisplayAsSelector ? feedConfig.displayAs || initialDisplayAs : initialDisplayAs
  )

  const setDisplayAs = (value: "list" | "grid") => {
    setDisplayAsState(value)
    // Save displayAs to the specific feed config only
    saveFeedConfig(feedConfig.id, {displayAs: value})
    onDisplayAsChange?.(value)
  }

  const {
    newEvents: newEventsMap,
    filteredEvents: subscribedEvents,
    additionalSearchResults,
    eventsByUnknownUsers,
    showNewEvents,
    loadMoreItems: hookLoadMoreItems,
    initialLoadDone: subscribedLoadDone,
    searchLoading: subscribedSearchLoading,
    canSearchMore,
  } = useFeedEvents({
    filters,
    cacheKey,
    displayCount,
    feedConfig,
    sortFn,
    relayUrls: feedConfig.relayUrls,
    bottomVisibleEventTimestamp,
    displayAs,
    subscriptionFilters,
    injectedEvents: eventSource ? undefined : injectedEvents,
    visibilitySnapshot,
    enabled: enabled && !eventSource,
  })

  // A bounded source can reuse the full Iris presentation without another relay query.
  const allEvents = useMemo(() => {
    const candidates = eventSource?.events ?? subscribedEvents
    const visible = groupVisibility
      ? candidates.filter((event) => !groupVisibility.shouldHideAlgorithmicEvent(event))
      : candidates
    return eventSource && sortFn ? [...visible].sort(sortFn) : visible
  }, [eventSource, subscribedEvents, groupVisibility, sortFn])
  const filteredEvents = useMemo(
    () => (selectEvents ? selectEvents(allEvents, displayCount) : allEvents),
    [allEvents, displayCount, selectEvents]
  )
  const initialLoadDone = eventSource ? !eventSource.loading : subscribedLoadDone
  const searchLoading = eventSource?.loading ?? subscribedSearchLoading

  // Track which events we've already notified about
  const notifiedEventIds = useRef(new Set<string>())

  // Call onEvent for new filtered events only
  useEffect(() => {
    if (onEvent && filteredEvents.length > 0) {
      filteredEvents.forEach((event) => {
        if ("content" in event && !notifiedEventIds.current.has(event.id)) {
          onEvent(event as NDKEvent)
          notifiedEventIds.current.add(event.id)
        }
      })
    }
  }, [filteredEvents, onEvent])

  const loadMoreItems = () => {
    const hasMore = eventSource
      ? selectEvents
        ? filteredEvents.length < allEvents.length
        : displayCount < allEvents.length
      : hookLoadMoreItems()
    if (hasMore) {
      setDisplayCount((prev: number) => prev + (selectEvents ? 20 : DISPLAY_INCREMENT))
    }
    return hasMore
  }

  const newEventsFiltered = useMemo(() => {
    return eventSource ? [] : Array.from(newEventsMap.values())
  }, [newEventsMap, eventSource])

  const newEventsFromFiltered = useMemo(() => {
    return new Set(newEventsFiltered.map((event) => event.pubkey))
  }, [newEventsFiltered])

  const gridEvents = useMemo(() => {
    if (displayAs === "grid") {
      const seen = new Set<string>()
      return filteredEvents
        .map((event) => {
          if ("content" in event && event.kind === 7) {
            const eTag = getTag("e", event.tags)
            return eTag ? {id: eTag} : null
          }
          return event
        })
        .filter((event): event is NDKEvent | {id: string} => {
          if (event === null) return false

          // Deduplicate by event ID to prevent multiple reposts of same event
          if (seen.has(event.id)) return false
          seen.add(event.id)
          return true
        })
    }
    return filteredEvents
  }, [filteredEvents, displayAs])
  const eventsById = useMemo(
    () =>
      new Map(
        [...filteredEvents, ...Array.from(additionalSearchResults.values()).flat()].map(
          (event) => [event.id, event]
        )
      ),
    [filteredEvents, additionalSearchResults]
  )

  const [, setForceUpdateCount] = useState(0)

  // Track events that should be highlighted (those added via showNewEvents)
  const [eventsToHighlight, setEventsToHighlight] = useState(new Set<string>())

  // Custom showNewEvents wrapper that tracks which events to highlight
  const showNewEventsWithHighlight = useCallback(() => {
    const eventIdsToHighlight = new Set(Array.from(newEventsMap.keys()))
    setEventsToHighlight(eventIdsToHighlight)
    showNewEvents()

    // Clear highlight after animation
    setTimeout(() => {
      setEventsToHighlight(new Set())
    }, 2000)
  }, [newEventsMap, showNewEvents])

  // Single observer for both seen tracking and lowest visible timestamp
  useEffect(() => {
    const seenTimers = new Map<string, number>()

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEvents: {id: string; timestamp: number; ratio: number}[] = []

        entries.forEach((entry) => {
          const eventId = entry.target.getAttribute("data-event-id")
          if (!eventId) return

          const event = eventsById.get(eventId)
          if (!event) return

          if (entry.isIntersecting) {
            visibleEvents.push({
              id: eventId,
              timestamp: "created_at" in event ? event.created_at || 0 : 0,
              ratio: entry.intersectionRatio,
            })

            // Start timer for marking as seen
            if (!seenTimers.has(eventId)) {
              const timerId = window.setTimeout(() => {
                addSeenEventId(eventId)
                seenTimers.delete(eventId)
              }, 1000)
              seenTimers.set(eventId, timerId)
            }
          } else {
            // Clear timer if item becomes hidden before 1s
            const timerId = seenTimers.get(eventId)
            if (timerId) {
              window.clearTimeout(timerId)
              seenTimers.delete(eventId)
            }
          }
        })

        // Find lowest timestamp among FULLY visible events (intersection ratio > 0.9)
        // If no fully visible events, set to Infinity to force all new events to buffer
        const fullyVisibleEvents = visibleEvents.filter((e) => e.ratio > 0.9)

        if (fullyVisibleEvents.length > 0) {
          const lowestTimestamp = Math.min(...fullyVisibleEvents.map((e) => e.timestamp))
          setBottomVisibleEventTimestamp(lowestTimestamp)
        } else if (visibleEvents.length > 0) {
          // Only partially visible items - use their timestamp as threshold
          const lowestTimestamp = Math.min(...visibleEvents.map((e) => e.timestamp))
          setBottomVisibleEventTimestamp(lowestTimestamp)
        } else {
          // No visible events - if we have events but no observer hits, use the newest event as fallback
          if (eventsById.size > 0) {
            const firstEvent = eventsById.values().next().value
            const firstEventTimestamp =
              firstEvent && "created_at" in firstEvent ? firstEvent.created_at || 0 : 0
            setBottomVisibleEventTimestamp((current) =>
              current === Infinity ? firstEventTimestamp : current
            )
          }
        }
      },
      {rootMargin: "-200px 0px 0px 0px"}
    )

    // Observe this feed's items after React commits them.
    const animationFrame = requestAnimationFrame(() => {
      const feedItems = feedContainerRef.current?.querySelectorAll("[data-event-id]")
      feedItems?.forEach((item) => observer.observe(item))
    })

    return () => {
      // Clear all pending timers
      seenTimers.forEach((timerId) => window.clearTimeout(timerId))
      seenTimers.clear()
      cancelAnimationFrame(animationFrame)
      observer.disconnect()
    }
  }, [displayAs, displayCount, eventsById, expandedSearchAuthors])

  // Auto-show new events if enabled
  useEffect(() => {
    if (feedConfig.autoShowNewEvents && newEventsFiltered.length > 0) {
      showNewEventsWithHighlight()
    }
  }, [feedConfig.autoShowNewEvents, newEventsFiltered.length, showNewEventsWithHighlight])

  useEffect(() => {
    if (forceUpdate !== undefined) {
      setForceUpdateCount((prev) => prev + 1)
    }
  }, [forceUpdate])

  const renderFeedItem = (event: NDKEvent, first = false) => (
    <div key={event.id} ref={first ? firstFeedItemRef : null} data-event-id={event.id}>
      <FeedItem
        asReply={asReply}
        showRepliedTo={feedConfig.showRepliedTo ?? true}
        showReplies={showReplies}
        event={event}
        borderTop={borderTopFirst && first}
        highlightAsNew={eventsToHighlight.has(event.id)}
        showAuthorInZapReceipts={feedConfig.showAuthorInZapReceipts}
      />
    </div>
  )

  return (
    <PerfProfiler id="Feed">
      <div ref={feedContainerRef} className="relative">
        {showDisplayAsSelector && (
          <DisplayAsSelector activeSelection={displayAs} onSelect={setDisplayAs} />
        )}

        {newEventsFiltered.length > 0 && !feedConfig.autoShowNewEvents && (
          <NewEventsButton
            newEventsFiltered={newEventsFiltered}
            newEventsFrom={newEventsFromFiltered}
            showNewEvents={showNewEventsWithHighlight}
            firstFeedItemRef={firstFeedItemRef}
          />
        )}

        {(feedConfig.showZapAll || forceShowZapAll) && filteredEvents.length > 0 && (
          <ZapAllButton events={filteredEvents} />
        )}

        <div>
          {filteredEvents.length > 0 && (
            <InfiniteScroll
              onLoadMore={selectEvents ? () => false : loadMoreItems}
              loadMoreKey={`${filteredEvents.length}:${displayCount}`}
              loading={searchLoading}
            >
              {displayAs === "grid" ? (
                <MediaFeed events={gridEvents} eventsToHighlight={eventsToHighlight} />
              ) : (
                <>
                  {filteredEvents.slice(0, displayCount).map((event, index) => {
                    const additional = additionalSearchResults.get(event.pubkey) || []
                    const expanded = expandedSearchAuthors.has(event.pubkey)
                    return (
                      <div key={event.id}>
                        {renderFeedItem(event, index === 0)}
                        {additional.length > 0 && (
                          <button
                            className="px-4 py-2 text-sm text-base-content/60 hover:text-base-content"
                            aria-expanded={expanded}
                            onClick={() =>
                              setExpandedSearchAuthors((previous) => {
                                const next = new Set(previous)
                                if (next.has(event.pubkey)) next.delete(event.pubkey)
                                else next.add(event.pubkey)
                                return next
                              })
                            }
                          >
                            {expanded
                              ? "Hide additional posts"
                              : `Show ${additional.length} more from this author`}
                          </button>
                        )}
                        {expanded && additional.map((match) => renderFeedItem(match))}
                      </div>
                    )
                  })}
                </>
              )}
            </InfiniteScroll>
          )}
          {selectEvents && filteredEvents.length < allEvents.length && (
            <button className="btn btn-ghost w-full" onClick={loadMoreItems}>
              Show more posts
            </button>
          )}
          {eventSource?.loading && (
            <p role="status" className="p-4 text-center text-sm text-base-content/55">
              Loading posts…
            </p>
          )}
          {filteredEvents.length === 0 &&
            newEventsFiltered.length === 0 &&
            initialLoadDone &&
            !searchLoading &&
            enabled &&
            emptyPlaceholder}
          {filters.search && (
            <div className="p-4 text-center text-base-content/50">
              {(searchLoading || !enabled) && <span role="status">Searching posts…</span>}
              {!searchLoading && enabled && canSearchMore && (
                <button className="btn btn-ghost btn-sm" onClick={loadMoreItems}>
                  Search older posts
                </button>
              )}
            </div>
          )}
          {myPubKey && eventsByUnknownUsers.length > 0 && (
            <div
              className="p-4 border-t border-b border-custom text-info text-center transition-colors duration-200 ease-in-out hover:underline hover:bg-[var(--note-hover-color)] cursor-pointer"
              onClick={() => setShowUnknownUserEvents(!showUnknownUserEvents)}
            >
              {showUnknownUserEvents ? "Hide" : "Show"} {eventsByUnknownUsers.length}{" "}
              events by unknown users
            </div>
          )}
          {showUnknownUserEvents && eventsByUnknownUsers.length > 0 && (
            <UnknownUserEvents
              eventsByUnknownUsers={eventsByUnknownUsers}
              showRepliedTo={feedConfig.showRepliedTo ?? true}
              asReply={true}
            />
          )}
        </div>
      </div>
    </PerfProfiler>
  )
})

export default Feed
