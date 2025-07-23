import {useState} from "react"
import {NDKEvent, NDKFilter} from "@nostr-dev-kit/ndk"
import {ndk} from "@/utils/ndk"

export default function usePostFetcher(
  nextMostPopular: (n: number) => {eventId: string; reactions: string[]}[]
) {
  const [events, setEvents] = useState<NDKEvent[]>([])
  const [loading, setLoading] = useState<boolean>(false)

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

  return {
    events,
    loading,
    loadMore,
  }
}
