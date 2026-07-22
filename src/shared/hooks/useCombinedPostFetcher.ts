import {useState, useEffect, useRef, useCallback} from "react"
import {NDKEvent, NDKFilter} from "@/lib/ndk"
import {addSeenEventId} from "@/utils/memcache"
import shuffle from "lodash/shuffle"
import {useUserStore} from "@/stores/user"
import {fetchEventsReliable} from "@/utils/fetchEventsReliable"

interface CombinedPostFetcherCache {
  events?: NDKEvent[]
  hasLoadedInitial?: boolean
}

interface CombinedPostFetcherProps {
  getNextPopular: (n: number) => string[]
  getNextChronological: (n: number) => string[]
  hasPopularData: boolean
  hasChronologicalData: boolean
  cache: CombinedPostFetcherCache
  popularRatio?: number
  excludeOwnPosts?: boolean
}

export default function useCombinedPostFetcher({
  getNextPopular,
  getNextChronological,
  hasPopularData,
  hasChronologicalData,
  cache,
  popularRatio = 0.5,
  excludeOwnPosts = false,
}: CombinedPostFetcherProps) {
  const [events, setEvents] = useState<NDKEvent[]>(cache.events || [])
  const [loading, setLoading] = useState<boolean>(false)
  const hasLoadedInitial = useRef(cache.hasLoadedInitial || false)
  const myPubKey = useUserStore((state) => state.publicKey)
  const isLoadingRef = useRef(false)

  useEffect(() => {
    cache.events = events
  }, [events, cache])

  useEffect(() => {
    cache.hasLoadedInitial = hasLoadedInitial.current
  }, [cache])

  const loadBatch = useCallback(
    async (batchSize: number = 10) => {
      const popularCount = Math.floor(batchSize * popularRatio)
      const chronologicalCount = batchSize - popularCount

      // Always try to get popular posts - let the function return empty if there's no data
      const popularIds = getNextPopular(popularCount)
      // Only get chronological if we're configured for it
      const chronologicalIds = hasChronologicalData
        ? getNextChronological(chronologicalCount)
        : []

      let allIds = [...new Set([...popularIds, ...chronologicalIds])]

      if (allIds.length < batchSize) {
        const remainingNeeded = batchSize - allIds.length
        if (hasPopularData && popularIds.length < remainingNeeded) {
          const extraPopular = getNextPopular(remainingNeeded)
          allIds = [...new Set([...allIds, ...extraPopular])]
        } else if (hasChronologicalData && chronologicalIds.length < remainingNeeded) {
          const extraChronological = getNextChronological(remainingNeeded)
          allIds = [...new Set([...allIds, ...extraChronological])]
        }
      }

      if (allIds.length === 0) {
        return []
      }
      const postFilter: NDKFilter = {
        ids: allIds,
      }

      const {promise} = fetchEventsReliable(postFilter, {
        timeout: 4000,
        settleAfterMs: 300,
      })
      let eventsArray = await promise

      if (excludeOwnPosts && myPubKey) {
        eventsArray = eventsArray.filter((event) => event.pubkey !== myPubKey)
      }

      const shuffledEvents = shuffle(eventsArray)
      return shuffledEvents
    },
    [
      getNextPopular,
      getNextChronological,
      hasPopularData,
      hasChronologicalData,
      popularRatio,
      myPubKey,
      excludeOwnPosts,
    ]
  )

  const loadInitial = useCallback(async () => {
    if (isLoadingRef.current || hasLoadedInitial.current) return
    isLoadingRef.current = true
    setLoading(true)

    try {
      let newEvents = await loadBatch(10)
      if (newEvents.length === 0) {
        newEvents = await loadBatch(10)
      }

      if (newEvents.length > 0) {
        newEvents.forEach((event) => addSeenEventId(event.id))
        setEvents(newEvents)
      }
    } catch {
      // Relay failures are expected; a later load can recover without leaving
      // an unhandled rejection or a permanent spinner.
    } finally {
      // Relay or cache failures must never leave the feed in a permanent spinner.
      hasLoadedInitial.current = true
      cache.hasLoadedInitial = true
      isLoadingRef.current = false
      setLoading(false)
    }
  }, [cache, loadBatch])

  const loadMore = useCallback(async () => {
    if (isLoadingRef.current) {
      return
    }

    isLoadingRef.current = true
    setLoading(true)

    try {
      const newEvents = await loadBatch(10)

      if (newEvents.length === 0) {
        return
      }

      newEvents.forEach((event) => addSeenEventId(event.id))

      setEvents((prevEvents) => {
        const existingIds = new Set(prevEvents.map((e) => e.id))
        const uniqueNewEvents = newEvents.filter((e) => !existingIds.has(e.id))
        return uniqueNewEvents.length > 0
          ? [...prevEvents, ...uniqueNewEvents]
          : prevEvents
      })
    } catch {
      // Keep the current feed when relays are temporarily unavailable.
    } finally {
      isLoadingRef.current = false
      setLoading(false)
    }
  }, [loadBatch])

  useEffect(() => {
    const hasAnyData = hasPopularData || hasChronologicalData
    if (hasAnyData && !hasLoadedInitial.current) {
      loadInitial()
    }
  }, [hasPopularData, hasChronologicalData, loadInitial])

  const isInitializing =
    !hasLoadedInitial.current && (hasPopularData || hasChronologicalData)
  const waitingForDataSources =
    !hasLoadedInitial.current && !hasPopularData && !hasChronologicalData

  return {
    events,
    loading: loading || isInitializing || waitingForDataSources,
    loadMore,
  }
}
