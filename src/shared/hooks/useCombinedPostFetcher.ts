import {useState, useEffect, useRef, useCallback} from "react"
import {NDKEvent, NDKFilter} from "@nostr-dev-kit/ndk"
import {ndk} from "@/utils/ndk"
import {addSeenEventId} from "@/utils/memcache"
import shuffle from "lodash/shuffle"
import {useUserStore} from "@/stores/user"

interface CombinedPostFetcherCache {
  events?: NDKEvent[]
}

interface CombinedPostFetcherProps {
  getNextPopular: (n: number) => string[]
  getNextChronological: (n: number) => string[]
  cache: CombinedPostFetcherCache
  popularRatio?: number
}

export default function useCombinedPostFetcher({
  getNextPopular,
  getNextChronological,
  cache,
  popularRatio = 0.5,
}: CombinedPostFetcherProps) {
  const [events, setEvents] = useState<NDKEvent[]>(cache.events || [])
  const [loading, setLoading] = useState<boolean>(false)
  const myPubKey = useUserStore((state) => state.publicKey)
  const isLoadingRef = useRef(false)

  useEffect(() => {
    cache.events = events
  }, [events, cache])

  const loadBatch = useCallback(
    async (batchSize: number = 10) => {
      const popularCount = Math.floor(batchSize * popularRatio)
      const chronologicalCount = batchSize - popularCount

      const popularIds = getNextPopular(popularCount)
      const chronologicalIds = getNextChronological(chronologicalCount)

      let allIds = [...new Set([...popularIds, ...chronologicalIds])]

      if (allIds.length < batchSize) {
        const remainingNeeded = batchSize - allIds.length
        if (popularIds.length < remainingNeeded) {
          const extraPopular = getNextPopular(remainingNeeded)
          allIds = [...new Set([...allIds, ...extraPopular])]
        } else if (chronologicalIds.length < remainingNeeded) {
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

      const fetchedEvents = await ndk().fetchEvents(postFilter)
      const eventsArray = Array.from(fetchedEvents)

      const shuffledEvents = shuffle(eventsArray)

      return shuffledEvents
    },
    [getNextPopular, getNextChronological, popularRatio, myPubKey]
  )

  const loadMore = useCallback(async () => {
    isLoadingRef.current = true
    setLoading(true)

    try {
      const newEvents = await loadBatch(10)

      newEvents.forEach((event) => addSeenEventId(event.id))

      setEvents((prevEvents) => {
        return [...prevEvents, ...newEvents]
      })

      isLoadingRef.current = false
      setLoading(false)
    } catch (error) {
      isLoadingRef.current = false
      setLoading(false)
    }
  }, [loadBatch])

  return {
    events,
    loading,
    loadMore,
  }
}
