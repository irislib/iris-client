import {useState, useEffect, useRef} from "react"
import {NDKEvent, NDKFilter} from "@nostr-dev-kit/ndk"
import {ndk} from "@/utils/ndk"

export default function usePostFetcher(
  nextMostPopular: (n: number) => {eventId: string; reactions: string[]}[],
  hasInitialData: boolean
) {
  const [events, setEvents] = useState<NDKEvent[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const hasLoadedInitial = useRef(false)

  const loadInitial = async () => {
    setLoading(true)
    const nextMostPopularEventIds = nextMostPopular(10).map((item) => item.eventId)
    if (nextMostPopularEventIds.length === 0) {
      setLoading(false)
      return
    }
    const postFilter: NDKFilter = {
      kinds: [1],
      ids: nextMostPopularEventIds,
    }
    const fetchedEvents = await ndk().fetchEvents(postFilter)
    setEvents(Array.from(fetchedEvents))
    setLoading(false)
  }

  const loadMore = async () => {
    setLoading(true)
    const nextMostPopularEventIds = nextMostPopular(10).map((item) => item.eventId)
    const postFilter: NDKFilter = {
      kinds: [1],
      ids: nextMostPopularEventIds,
    }
    const fetchedEvents = await ndk().fetchEvents(postFilter)
    setEvents((prevEvents) => [...prevEvents, ...Array.from(fetchedEvents)])
    setLoading(false)
  }

  useEffect(() => {
    if (hasInitialData && !hasLoadedInitial.current) {
      hasLoadedInitial.current = true
      loadInitial()
    }
  }, [hasInitialData])

  return {
    events,
    loading,
    loadMore,
  }
}
