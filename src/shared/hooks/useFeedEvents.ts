import {useEffect, useMemo, useRef, useState, useCallback} from "react"
import {eventComparator} from "../components/feed/utils"
import {NDKEvent, NDKFilter} from "@/lib/ndk"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {shouldHideUser, shouldHideEvent} from "@/utils/visibility"
import {useSocialGraph} from "@/utils/socialGraph"
import {seenEventIds} from "@/utils/memcache"
import {useUserStore} from "@/stores/user"
import debounce from "lodash/debounce"
import {ndk} from "@/utils/ndk"
import {getEventReplyingTo} from "@/utils/nostr"
import {hasMedia} from "@/shared/components/embed"
import {hasImageOrVideo} from "@/shared/utils/mediaUtils"
import {type FeedConfig} from "@/stores/feed"
import DebugManager from "@/utils/DebugManager"
import {KIND_PICTURE_FIRST} from "@/utils/constants"
import {buildSearchSubscriptionFilters} from "./buildSearchSubscriptionFilters"

interface FutureEvent {
  event: NDKEvent
  timer: NodeJS.Timeout
}

interface UseFeedEventsProps {
  filters: NDKFilter
  cacheKey: string
  displayCount: number
  feedConfig: FeedConfig
  sortFn?: (a: NDKEvent, b: NDKEvent) => number
  relayUrls?: string[]
  bottomVisibleEventTimestamp?: number
  displayAs?: "list" | "grid"
}

export default function useFeedEvents({
  filters,
  cacheKey,
  displayCount,
  feedConfig,
  sortFn,
  relayUrls,
  bottomVisibleEventTimestamp = Infinity,
  displayAs = "list",
}: UseFeedEventsProps) {
  const socialGraph = useSocialGraph()
  const bottomVisibleEventTimestampRef = useRef(bottomVisibleEventTimestamp)
  bottomVisibleEventTimestampRef.current = bottomVisibleEventTimestamp
  const myPubKey = useUserStore((state) => state.publicKey)
  const [newEventsFrom, setNewEventsFrom] = useState(new Set<string>())
  const [newEvents, setNewEvents] = useState(new Map<string, NDKEvent>())
  const eventsRef = useRef(
    new SortedMap(
      [],
      sortFn
        ? ([, a]: [string, NDKEvent], [, b]: [string, NDKEvent]) => sortFn(a, b)
        : eventComparator
    )
  )
  // Buffer for future events (max 20 entries, sorted by timestamp)
  const futureEventsRef = useRef(
    new SortedMap<string, FutureEvent>(
      [],
      ([, a]: [string, FutureEvent], [, b]: [string, FutureEvent]) => {
        return (a.event.created_at || 0) - (b.event.created_at || 0) // Sort by timestamp ascending
      }
    )
  )
  const oldestRef = useRef<number | undefined>(undefined)
  const [untilTimestamp, setUntilTimestamp] = useState<number | undefined>(undefined)
  const initialLoadDoneRef = useRef<boolean>(eventsRef.current.size > 0)
  const [initialLoadDoneState, setInitialLoadDoneState] = useState(
    initialLoadDoneRef.current
  )
  const hasReceivedEventsRef = useRef<boolean>(eventsRef.current.size > 0)
  const [eventsVersion, setEventsVersion] = useState(0) // Version counter for filtered events

  // Memoize normalized relay URLs to avoid recreating on every event
  const normalizedTargetRelays = useMemo(() => {
    if (!feedConfig.relayUrls?.length) return null
    const normalizeRelay = (url: string) =>
      url.replace(/^(https?:\/\/)?(wss?:\/\/)?/, "").replace(/\/$/, "")
    return feedConfig.relayUrls.map(normalizeRelay)
  }, [JSON.stringify(feedConfig.relayUrls)])

  const shouldAcceptEventRef = useRef<(event: NDKEvent) => boolean>(() => false)

  shouldAcceptEventRef.current = (event: NDKEvent) => {
    if (!event.created_at) return false

    // Early exit: excludeSeen check (combined duplicate checks)
    if (feedConfig.excludeSeen && seenEventIds.has(event.id)) {
      return false
    }

    // Cache expensive calls
    const replyingTo =
      feedConfig.hideReplies || feedConfig.requiresReplies || feedConfig.repliesTo
        ? getEventReplyingTo(event)
        : null

    if (feedConfig.hideReplies && replyingTo) return false
    if (feedConfig.requiresReplies && !replyingTo) return false
    if (feedConfig.repliesTo && replyingTo !== feedConfig.repliesTo) return false

    // Feed-specific display filtering
    if (feedConfig.requiresMedia && event.kind !== KIND_PICTURE_FIRST && !hasMedia(event))
      return false

    // Display mode filtering - in grid mode, only accept events with images/videos
    if (displayAs === "grid") {
      if (
        !event.content ||
        typeof event.content !== "string" ||
        !hasImageOrVideo(event.content)
      ) {
        return false
      }
    }

    // Location tag filtering for map feeds
    if (feedConfig.requiresLocationTag) {
      const hasGeohashTag = event.tags?.some((tag) => tag[0] === "g" && tag[1])
      const hasLocationTag = event.tags?.some((tag) => tag[0] === "location" && tag[1])
      if (!hasGeohashTag && !hasLocationTag) {
        return false
      }
    }

    // Relay filtering - use pre-normalized relays
    if (normalizedTargetRelays) {
      if (!event.onRelays?.length) return false
      const normalizeRelay = (url: string) =>
        url.replace(/^(https?:\/\/)?(wss?:\/\/)?/, "").replace(/\/$/, "")
      const eventIsOnTargetRelay = event.onRelays.some((relay) =>
        normalizedTargetRelays.includes(normalizeRelay(relay.url))
      )
      if (!eventIsOnTargetRelay) return false
    }

    // Custom author check
    const customAuthors = feedConfig.filter?.authors
    const hasCustomAuthors = customAuthors && customAuthors.length > 0
    const isCustomAuthor = hasCustomAuthors && customAuthors.includes(event.pubkey)

    // Follow distance filtering
    // Skip followDistance entirely when custom authors are defined
    if (feedConfig.followDistance !== undefined && !hasCustomAuthors) {
      const eventFollowDistance = socialGraph.getFollowDistance(event.pubkey)
      if (eventFollowDistance > feedConfig.followDistance) return false
    }

    // Client-side search validation for relays that don't support search filters
    // Also validate hashtag matches
    if (filters.search) {
      const searchTerms = filters.search.toLowerCase().split(/\s+/)
      const eventContent = event.content?.toLowerCase() || ""

      // Get event's t tags
      const tTags =
        event.tags
          ?.filter((tag) => tag[0] === "t" && tag[1])
          ?.map((tag) => tag[1].toLowerCase()) || []

      // Check if all search terms are present
      const allTermsMatch = searchTerms.every((term) => {
        if (term.startsWith("#")) {
          // For hashtags, only check in t tags, not content
          const cleanTerm = term.substring(1)
          return tTags.includes(cleanTerm)
        } else {
          // For regular words, check in content
          return eventContent.includes(term)
        }
      })

      if (!allTermsMatch) {
        return false
      }
    }

    const inAuthors = filters.authors?.includes(event.pubkey)

    // Custom authors bypass mute/hide checks
    if (isCustomAuthor) {
      return true
    }

    // Check if event should be hidden based on mute/overmute
    // Skip follow distance check since it's already done above
    if (!inAuthors && shouldHideEvent(event, 3, true)) {
      return false
    }
    return true
  }

  // Apply a single future event when its time comes
  const applyFutureEvent = useCallback((eventId: string) => {
    const futureEvent = futureEventsRef.current.get(eventId)
    if (futureEvent) {
      const {event} = futureEvent
      futureEventsRef.current.delete(eventId)

      if (!eventsRef.current.has(eventId) && shouldAcceptEventRef.current!(event)) {
        setNewEvents((prev) => new Map([...prev, [eventId, event]]))
        setNewEventsFrom((prev) => new Set([...prev, event.pubkey]))
      }
    }
  }, [])

  // Add future event to buffer with individual timer
  const addFutureEvent = useCallback((event: NDKEvent) => {
    if (!event.created_at) return

    const now = Math.floor(Date.now() / 1000)
    const delay = (event.created_at - now) * 1000 // Convert to milliseconds

    // Clear existing future event if any (this will cancel its timer)
    const existingFutureEvent = futureEventsRef.current.get(event.id)
    if (existingFutureEvent) {
      clearTimeout(existingFutureEvent.timer)
      futureEventsRef.current.delete(event.id)
    }

    // Set timer for this specific event
    const timer = setTimeout(() => {
      applyFutureEvent(event.id)
    }, delay)

    // Add to buffer
    futureEventsRef.current.set(event.id, {event, timer})

    // Keep only the 20 most recent future events (evict oldest)
    while (futureEventsRef.current.size > 20) {
      const firstEntry = futureEventsRef.current.entries().next().value
      if (firstEntry) {
        const [oldId, oldFutureEvent] = firstEntry
        clearTimeout(oldFutureEvent.timer) // Cancel timer on evict
        futureEventsRef.current.delete(oldId)
      }
    }
  }, [])

  const showNewEvents = () => {
    const eventCount = newEvents.size
    newEvents.forEach((event) => {
      if (!eventsRef.current.has(event.id)) {
        eventsRef.current.set(event.id, event)
      }
    })
    setNewEvents(new Map())
    setNewEventsFrom(new Set())
    setEventsVersion((prev) => prev + 1)

    // Debug logging
    const debugSession = DebugManager.getDebugSession()
    if (debugSession) {
      debugSession.publish("feed_events", {
        action: "showNewEvents",
        cacheKey,
        feedName: feedConfig.name || feedConfig.id || "unknown",
        eventsRefSize: eventsRef.current.size,
        newEventsShown: eventCount,
        timestamp: Date.now(),
      })
    }
  }

  const filteredEvents = useMemo((): NDKEvent[] => {
    // Events are already filtered on insertion via shouldAcceptEventRef
    // No need to re-filter the entire cache - just return as array
    return Array.from(eventsRef.current.values())
  }, [eventsVersion])

  const eventsByUnknownUsers = useMemo(() => {
    // Don't show unknown user events when custom authors are defined
    const customAuthors = feedConfig.filter?.authors || []
    if (customAuthors.length > 0) {
      return []
    }

    // Only show events by unknown users when followDistance is set
    if (feedConfig.followDistance === undefined) {
      return []
    }
    return Array.from(eventsRef.current.values()).filter(
      (event) =>
        socialGraph.getFollowDistance(event.pubkey) > feedConfig.followDistance! &&
        !(filters.authors && filters.authors.includes(event.pubkey)) &&
        // Only include events that aren't heavily muted
        !shouldHideUser(event.pubkey, undefined, true)
    )
  }, [
    eventsVersion,
    feedConfig.followDistance,
    feedConfig.filter?.authors,
    filters.authors,
  ])

  const prevFiltersStringRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    const filtersString = JSON.stringify(filters)
    if (prevFiltersStringRef.current !== filtersString) {
      prevFiltersStringRef.current = filtersString
      oldestRef.current = undefined
      setUntilTimestamp(undefined)
    }
  }, [filters])

  useEffect(() => {
    if (filters.authors && filters.authors.length === 0) {
      return
    }

    const subscriptionFilters = buildSearchSubscriptionFilters(
      filters,
      untilTimestamp,
      Math.max(displayCount, 100)
    )
    const subscriptionFilterList = Array.isArray(subscriptionFilters)
      ? subscriptionFilters
      : [subscriptionFilters]
    const subs = subscriptionFilterList.map((subscriptionFilter) =>
      ndk().subscribe(subscriptionFilter, relayUrls ? {relayUrls} : undefined)
    )

    // Reset these flags when subscription changes
    hasReceivedEventsRef.current = eventsRef.current.size > 0
    initialLoadDoneRef.current = eventsRef.current.size > 0
    setInitialLoadDoneState(eventsRef.current.size > 0)

    // Set up a timeout to mark initial load as done even if no events arrive
    const initialLoadTimeout = setTimeout(() => {
      if (!initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true
        setInitialLoadDoneState(true)
      }
    }, 5000)

    const markLoadDoneIfHasEvents = debounce(() => {
      if (hasReceivedEventsRef.current && !initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true
        setInitialLoadDoneState(true)
      }
    }, 500)

    const handleEvent = (event: NDKEvent) => {
      if (!event?.id || !event.created_at) return
      if (eventsRef.current.has(event.id)) return
      if (!shouldAcceptEventRef.current!(event)) {
        return
      }

      const now = Math.floor(Date.now() / 1000)
      const isFutureEvent = event.created_at > now

      // Handle future events separately
      if (isFutureEvent) {
        addFutureEvent(event)
        return
      }

      oldestRef.current = Math.min(
        oldestRef.current ?? event.created_at,
        event.created_at
      )
      hasReceivedEventsRef.current = true

      const addMain = () => {
        eventsRef.current.set(event.id, event)
        setEventsVersion((prev) => prev + 1)

        // Debug logging
        const debugSession = DebugManager.getDebugSession()
        if (debugSession) {
          debugSession.publish("feed_events", {
            action: "addMain",
            cacheKey,
            feedName: feedConfig.name || feedConfig.id || "unknown",
            eventsRefSize: eventsRef.current.size,
            eventId: event.id,
            timestamp: Date.now(),
          })
        }
      }
      const addNew = () => {
        setNewEvents((prev) => new Map([...prev, [event.id, event]]))
        setNewEventsFrom((prev) => new Set([...prev, event.pubkey]))
      }

      const isMyRecent =
        event.pubkey === myPubKey && event.created_at * 1000 > Date.now() - 10000
      const isNewEvent = initialLoadDoneRef.current && !isMyRecent

      // Check if event would appear below viewport (no layout shift)
      // Events with older timestamps appear below newer ones in chronological feed
      const currentBottomVisible = bottomVisibleEventTimestampRef.current
      const wouldBeInViewport =
        isNewEvent && (event.created_at || 0) >= currentBottomVisible
      const wouldBeBelowViewport =
        isNewEvent && (event.created_at || 0) < currentBottomVisible

      if (wouldBeBelowViewport) {
        addMain() // Add directly, no layout shift
      } else if (isNewEvent && wouldBeInViewport) {
        addNew() // Buffer for "show new" button
      } else {
        addMain()
      }

      markLoadDoneIfHasEvents()
    }

    subs.forEach((sub) => sub.on("event", handleEvent))
    return () => {
      subs.forEach((sub) => sub.stop())
      clearTimeout(initialLoadTimeout)
      markLoadDoneIfHasEvents.cancel()
    }
  }, [JSON.stringify(filters), untilTimestamp, addFutureEvent])

  // Cleanup future event timers on unmount
  useEffect(() => {
    return () => {
      // Clear all future event timers
      for (const [, futureEvent] of futureEventsRef.current.entries()) {
        clearTimeout(futureEvent.timer)
      }
      futureEventsRef.current.clear()
    }
  }, [])

  const loadMoreItems = () => {
    if (filteredEvents.length > displayCount) {
      return true
    } else if (untilTimestamp !== oldestRef.current) {
      setUntilTimestamp(oldestRef.current)
    }
    return false
  }

  return {
    events: eventsRef,
    newEvents,
    newEventsFrom,
    filteredEvents,
    eventsByUnknownUsers,
    showNewEvents,
    loadMoreItems,
    initialLoadDone: initialLoadDoneState,
  }
}
