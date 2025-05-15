import {useEffect, useMemo, useRef, useState, useCallback} from "react"
import {eventComparator} from "../components/feed/utils"
import {NDKEvent, NDKFilter} from "@nostr-dev-kit/ndk"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {shouldHideAuthor} from "@/utils/visibility"
import socialGraph from "@/utils/socialGraph"
import {feedCache} from "@/utils/memcache"
import {useUserStore} from "@/stores/user"
import debounce from "lodash/debounce"
import {ndk} from "@/utils/ndk"

interface UseFeedEventsProps {
  filters: NDKFilter
  cacheKey: string
  displayCount: number
  displayFilterFn?: (event: NDKEvent) => boolean
  fetchFilterFn?: (event: NDKEvent) => boolean
  hideEventsByUnknownUsers: boolean
  mutes: string[]
  sortLikedPosts?: boolean
  sortFn?: (a: NDKEvent, b: NDKEvent) => number
}

export default function useFeedEvents({
  filters,
  cacheKey,
  displayCount,
  displayFilterFn,
  fetchFilterFn,
  sortFn,
  hideEventsByUnknownUsers,
  mutes,
  sortLikedPosts = false,
}: UseFeedEventsProps) {
  const myPubKey = useUserStore((state) => state.publicKey)
  const [localFilter, setLocalFilter] = useState(filters)
  const [newEventsFrom, setNewEventsFrom] = useState(new Set<string>())
  const [newEvents, setNewEvents] = useState(new Map<string, NDKEvent>())
  const eventsRef = useRef(
    feedCache.get(cacheKey) ||
      new SortedMap(
        [],
        sortFn
          ? ([, a]: [string, NDKEvent], [, b]: [string, NDKEvent]) => sortFn(a, b)
          : eventComparator
      )
  )
  const oldestRef = useRef<number | undefined>(undefined)
  const initialLoadDoneRef = useRef<boolean>(eventsRef.current.size > 0)
  const [initialLoadDoneState, setInitialLoadDoneState] = useState(
    initialLoadDoneRef.current
  )

  const showNewEvents = () => {
    newEvents.forEach((event) => {
      if (!eventsRef.current.has(event.id)) {
        eventsRef.current.set(event.id, event)
      }
    })
    setNewEvents(new Map())
    setNewEventsFrom(new Set())
  }

  const filterEvents = useCallback(
    (event: NDKEvent) => {
      if (!event.created_at) return false
      if (displayFilterFn && !displayFilterFn(event)) return false
      const inAuthors = localFilter.authors?.includes(event.pubkey)
      if (!inAuthors && mutes.includes(event.pubkey)) return false
      if (!inAuthors && shouldHideAuthor(event.pubkey, 3)) {
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
    [displayFilterFn, myPubKey, hideEventsByUnknownUsers, filters.authors, mutes]
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
  }, [eventsRef.current.size, filterEvents, sortLikedPosts])

  const eventsByUnknownUsers = useMemo(() => {
    if (!hideEventsByUnknownUsers) {
      return []
    }
    return Array.from(eventsRef.current.values()).filter(
      (event) =>
        (!displayFilterFn || displayFilterFn(event)) &&
        shouldHideAuthor(event.author.pubkey)
    )
  }, [eventsRef.current.size, displayFilterFn])

  useEffect(() => {
    setLocalFilter(filters)
    oldestRef.current = undefined
  }, [filters])

  useEffect(() => {
    if (localFilter.authors && localFilter.authors.length === 0) {
      return
    }

    const sub = ndk().subscribe(localFilter)

    const debouncedInitialLoadDone = debounce(
      () => {
        initialLoadDoneRef.current = true
        setInitialLoadDoneState(true)
      },
      500,
      {maxWait: 2000}
    )

    debouncedInitialLoadDone()

    sub.on("event", (event) => {
      if (!event || !event.id) return
      if (event.created_at && !eventsRef.current.has(event.id)) {
        if (oldestRef.current === undefined || oldestRef.current > event.created_at) {
          oldestRef.current = event.created_at
        }
        if (fetchFilterFn && !fetchFilterFn(event)) {
          return
        }
        const lastShownIndex = Math.min(displayCount, eventsRef.current.size) - 1
        const oldestShownTime =
          lastShownIndex >= 0 && eventsRef.current.nth(lastShownIndex)?.[1].created_at
        const isMyRecent =
          event.pubkey === myPubKey && event.created_at * 1000 > Date.now() - 10000
        if (
          !isMyRecent &&
          initialLoadDoneRef.current &&
          (!oldestShownTime || event.created_at > oldestShownTime)
        ) {
          setNewEvents((prev) => new Map([...prev, [event.id, event]]))
          setNewEventsFrom((prev) => new Set([...prev, event.pubkey]))
        } else {
          eventsRef.current.set(event.id, event)
          if (!initialLoadDoneRef.current) {
            debouncedInitialLoadDone()
          }
        }
      }
    })

    return () => {
      sub.stop()
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
