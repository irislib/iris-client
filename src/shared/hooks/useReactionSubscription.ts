import {useEffect, useRef, useState} from "react"
import {NDKFilter} from "@nostr-dev-kit/ndk"
import {ndk} from "@/utils/ndk"
import {REACTION_KIND, REPOST_KIND} from "@/pages/chats/utils/constants"
import {getTag} from "@/utils/nostr"
import {PopularityFilters} from "./usePopularityFilters"

const LOW_THRESHOLD = 30
const INITIAL_DATA_THRESHOLD = 10

export default function useReactionSubscription(
  currentFilters: PopularityFilters,
  expandFilters: () => void
) {
  const showingReactionCounts = useRef<Map<string, Set<string>>>(new Map())
  const pendingReactionCounts = useRef<Map<string, Set<string>>>(new Map())
  const [hasInitialData, setHasInitialData] = useState(false)

  useEffect(() => {
    const {timeRange, limit, authors: filterAuthors} = currentFilters
    const now = Math.floor(Date.now() / 1000)
    const since = now - timeRange

    const reactionFilter: NDKFilter = {
      kinds: [REACTION_KIND, REPOST_KIND],
      since,
      authors: filterAuthors,
      limit,
    }

    const sub = ndk().subscribe(reactionFilter)

    sub.on("event", (event) => {
      if (event.kind !== REACTION_KIND) return

      const originalPostId = getTag("e", event.tags)

      if (!originalPostId) return

      if (showingReactionCounts.current.has(originalPostId)) {
        showingReactionCounts.current.get(originalPostId)?.add(event.id)
      } else if (pendingReactionCounts.current.has(originalPostId)) {
        pendingReactionCounts.current.get(originalPostId)?.add(event.id)
      } else {
        pendingReactionCounts.current.set(originalPostId, new Set([event.id]))
      }

      // Check if we have enough initial data
      if (!hasInitialData && pendingReactionCounts.current.size >= INITIAL_DATA_THRESHOLD) {
        setHasInitialData(true)
      }
    })

    return () => sub.stop()
  }, [currentFilters, hasInitialData])

  const getNextMostPopular = (n: number) => {
    const currentPendingCount = pendingReactionCounts.current.size
    if (currentPendingCount <= LOW_THRESHOLD) {
      expandFilters()
    }

    const top = Array.from(pendingReactionCounts.current.entries())
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, n)

    top.forEach(([eventId, reactions]) => {
      pendingReactionCounts.current.delete(eventId)
      showingReactionCounts.current.set(eventId, reactions)
    })

    return top.map(([eventId, reactions]) => ({
      eventId,
      reactions: Array.from(reactions),
    }))
  }

  return {
    getNextMostPopular,
    hasInitialData,
  }
}
