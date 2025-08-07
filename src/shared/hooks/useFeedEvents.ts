import {useEffect, useMemo, useRef, useState, useCallback} from "react"
import {eventComparator} from "../components/feed/utils"
import {NDKEvent, NDKFilter} from "@nostr-dev-kit/ndk"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {shouldHideAuthor} from "@/utils/visibility"
import socialGraph from "@/utils/socialGraph"
import {seenEventIds} from "@/utils/memcache"
import {useUserStore} from "@/stores/user"
import debounce from "lodash/debounce"
import {ndk} from "@/utils/ndk"
import {getEventReplyingTo} from "@/utils/nostr"
import {hasMedia} from "@/shared/components/embed"
import {hasImageOrVideo} from "@/shared/utils/mediaUtils"
import {type FeedConfig} from "@/stores/feed"
import DebugManager from "@/utils/DebugManager"
import {KIND_TEXT_NOTE} from "@/utils/constants"

interface FutureEvent {
  event: NDKEvent
  timer: NodeJS.Timeout
}

interface UseFeedEventsProps {
  filters: NDKFilter
  cacheKey: string
  displayCount: number
  feedConfig: FeedConfig
  hideEventsByUnknownUsers: boolean
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
  hideEventsByUnknownUsers,
  sortFn,
  relayUrls,
  bottomVisibleEventTimestamp = Infinity,
  displayAs = "list",
}: UseFeedEventsProps) {
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

  const shouldAcceptEventRef = useRef<(event: NDKEvent) => boolean>(() => false)

  shouldAcceptEventRef.current = (event: NDKEvent) => {
    if (!event.created_at) return false

    // Feed-specific filtering (from fetchFilterFn)
    if (feedConfig.excludeSeen && seenEventIds.has(event.id)) return false
    if (feedConfig.hideReplies && getEventReplyingTo(event)) return false

    // Feed-specific display filtering (from displayFilterFn)
    if (feedConfig.requiresMedia && !hasMedia(event)) return false
    if (feedConfig.requiresReplies && !getEventReplyingTo(event)) return false
    if (feedConfig.repliesTo && getEventReplyingTo(event) !== feedConfig.repliesTo)
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

    if (feedConfig.excludeSeen && seenEventIds.has(event.id)) {
      return false
    }

    // Relay filtering (from combinedDisplayFilterFn)
    if (feedConfig.relayUrls?.length) {
      if (!event.onRelays?.length) return false
      const normalizeRelay = (url: string) =>
        url.replace(/^(https?:\/\/)?(wss?:\/\/)?/, "").replace(/\/$/, "")
      const normalizedTargetRelays = feedConfig.relayUrls.map(normalizeRelay)
      const eventIsOnTargetRelay = event.onRelays.some((relay) =>
        normalizedTargetRelays.includes(normalizeRelay(relay.url))
      )
      if (!eventIsOnTargetRelay) return false
    }

    // Follow distance filtering
    if (feedConfig.followDistance !== undefined) {
      const eventFollowDistance = socialGraph().getFollowDistance(event.pubkey)
      if (eventFollowDistance > feedConfig.followDistance) return false
    }

    // Client-side search validation for relays that don't support search filters
    if (filters.search) {
      if (!event.content) return false
      const searchTerm = filters.search.toLowerCase()
      const eventContent = event.content.toLowerCase()
      if (!eventContent.includes(searchTerm)) {
        return false
      }
    }

    const inAuthors = filters.authors?.includes(event.pubkey)
    // Pass `allowUnknown` based on the `hideEventsByUnknownUsers` flag so that
    // disabling the flag actually shows posts from users outside the follow graph.
    if (!inAuthors && shouldHideAuthor(event.pubkey, 3, !hideEventsByUnknownUsers)) {
      return false
    }
    if (
      hideEventsByUnknownUsers &&
      socialGraph().getFollowDistance(event.pubkey) >= 5 &&
      !(filters.authors && filters.authors.includes(event.pubkey))
    ) {
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
    const events = Array.from(eventsRef.current.values())

    return events
  }, [eventsVersion])

  const eventsByUnknownUsers = useMemo(() => {
    if (!hideEventsByUnknownUsers) {
      return []
    }
    return Array.from(eventsRef.current.values()).filter(
      (event) =>
        socialGraph().getFollowDistance(event.pubkey) >= 5 &&
        !(filters.authors && filters.authors.includes(event.pubkey)) &&
        // Only include events that aren't heavily muted
        !shouldHideAuthor(event.pubkey, undefined, true)
    )
  }, [eventsVersion, hideEventsByUnknownUsers, filters.authors])

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

    const subscriptionFilter = untilTimestamp
      ? {...filters, until: untilTimestamp}
      : filters

    const sub = ndk().subscribe(subscriptionFilter, relayUrls ? {relayUrls} : undefined)

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

    sub.on("event", (event) => {
      if (!event?.id || !event.created_at) return
      if (eventsRef.current.has(event.id)) return
      if (!shouldAcceptEventRef.current!(event)) return

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
      const isNewEvent =
        initialLoadDoneRef.current && !isMyRecent && event.kind === KIND_TEXT_NOTE

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
    })
    return () => {
      sub.stop()
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
