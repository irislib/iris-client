import {useEffect, useMemo, useRef, useState, useCallback} from "react"
import {eventComparator} from "../components/feed/utils"
import {NostrEvent, Filter} from "nostr-tools"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {shouldHideAuthor} from "@/utils/visibility"
import socialGraph from "@/utils/socialGraph"
import {feedCache} from "@/utils/memcache"
import {useUserStore} from "@/stores/user"
import debounce from "lodash/debounce"
import {subscribe} from "@/utils/applesauce"

interface UseFeedEventsProps {
  filters: Filter
  cacheKey: string
  displayCount: number
  displayFilterFn?: (event: NostrEvent) => boolean
  fetchFilterFn?: (event: NostrEvent) => boolean
  hideEventsByUnknownUsers: boolean
  sortLikedPosts?: boolean
  sortFn?: (a: NostrEvent, b: NostrEvent) => number
  relayUrls?: string[]
}

export default function useFeedEvents({
  filters,
  cacheKey,
  displayCount,
  displayFilterFn,
  fetchFilterFn,
  sortFn,
  hideEventsByUnknownUsers,
  sortLikedPosts = false,
  relayUrls: _relayUrls, // Temporarily unused in applesauce migration
}: UseFeedEventsProps) {
  const myPubKey = useUserStore((state) => state.publicKey)
  const [localFilter, setLocalFilter] = useState(filters)
  const [newEventsFrom, setNewEventsFrom] = useState(new Set<string>())
  const [newEvents, setNewEvents] = useState(new Map<string, NostrEvent>())
  const eventsRef = useRef(
    feedCache.get(cacheKey) ||
      new SortedMap(
        [],
        sortFn
          ? ([, a]: [string, NostrEvent], [, b]: [string, NostrEvent]) => sortFn(a, b)
          : eventComparator
      )
  )
  const oldestRef = useRef<number | undefined>(undefined)
  const initialLoadDoneRef = useRef<boolean>(eventsRef.current.size > 0)
  const [initialLoadDoneState, setInitialLoadDoneState] = useState(
    initialLoadDoneRef.current
  )
  const hasReceivedEventsRef = useRef<boolean>(eventsRef.current.size > 0)
  const [eventsVersion, setEventsVersion] = useState(0) // Version counter for filtered events

  const showNewEvents = () => {
    newEvents.forEach((event) => {
      if (!eventsRef.current.has(event.id)) {
        eventsRef.current.set(event.id, event)
      }
    })
    setNewEvents(new Map())
    setNewEventsFrom(new Set())
    setEventsVersion((prev) => prev + 1)
  }

  const filterEvents = useCallback(
    (event: NostrEvent) => {
      if (!event.created_at) return false
      if (displayFilterFn && !displayFilterFn(event)) return false
      const inAuthors = localFilter.authors?.includes(event.pubkey)
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
    },
    [displayFilterFn, localFilter.authors, hideEventsByUnknownUsers, filters.authors]
  )

  const filteredEvents = useMemo(() => {
    const events = Array.from(eventsRef.current.values()).filter(filterEvents)

    if (sortLikedPosts) {
      const likesByPostId = new Map<string, number>()
      events.forEach((event) => {
        const postId = event.tags.find((t) => t[0] === "e")?.[1]
        if (postId) {
          likesByPostId.set(postId, (likesByPostId.get(postId) || 0) + 1)
        }
      })

      const sortedIds = Array.from(likesByPostId.entries())
        .sort(([, likesA], [, likesB]) => likesB - likesA)
        .map(([postId]) => postId)

      return sortedIds.map((id) => {
        const event = Array.from(eventsRef.current.values()).find((e) => e.id === id)
        return event || {id}
      })
    }

    return events
  }, [eventsVersion, filterEvents, sortLikedPosts])

  const eventsByUnknownUsers = useMemo(() => {
    if (!hideEventsByUnknownUsers) {
      return []
    }
    return Array.from(eventsRef.current.values()).filter(
      (event) =>
        (!displayFilterFn || displayFilterFn(event)) &&
        socialGraph().getFollowDistance(event.pubkey) >= 5 &&
        !(filters.authors && filters.authors.includes(event.pubkey)) &&
        // Only include events that aren't heavily muted
        !shouldHideAuthor(event.pubkey, undefined, true)
    )
  }, [eventsVersion, displayFilterFn, hideEventsByUnknownUsers, filters.authors])

  useEffect(() => {
    setLocalFilter(filters)
    oldestRef.current = undefined
  }, [filters])

  useEffect(() => {
    if (localFilter.authors && localFilter.authors.length === 0) {
      return
    }

    const sub = subscribe(localFilter)

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
      if (fetchFilterFn && !fetchFilterFn(event)) return

      oldestRef.current = Math.min(
        oldestRef.current ?? event.created_at,
        event.created_at
      )
      hasReceivedEventsRef.current = true

      const addMain = () => {
        eventsRef.current.set(event.id, event)
        setEventsVersion((prev) => prev + 1)
      }
      const addNew = () => {
        setNewEvents((prev) => new Map([...prev, [event.id, event]]))
        setNewEventsFrom((prev) => new Set([...prev, event.pubkey]))
      }

      const isMyRecent =
        event.pubkey === myPubKey && event.created_at * 1000 > Date.now() - 10000
      const isNewEvent =
        initialLoadDoneRef.current && !isMyRecent && (!sortLikedPosts || event.kind === 1)

      if (isNewEvent) addNew()
      else addMain()

      markLoadDoneIfHasEvents()
    })
    return () => {
      sub.stop()
      clearTimeout(initialLoadTimeout)
      markLoadDoneIfHasEvents.cancel()
    }
  }, [JSON.stringify(localFilter)])

  useEffect(() => {
    eventsRef.current.size &&
      !feedCache.has(cacheKey) &&
      feedCache.set(cacheKey, eventsRef.current)
  }, [eventsRef.current.size])

  const loadMoreItems = () => {
    if (filteredEvents.length > displayCount) {
      return true
    } else if (localFilter.until !== oldestRef.current) {
      setLocalFilter((prev) => ({
        ...prev,
        until: oldestRef.current,
      }))
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
