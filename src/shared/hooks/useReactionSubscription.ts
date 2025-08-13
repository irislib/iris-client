import {useEffect, useRef} from "react"
import {NDKFilter} from "@nostr-dev-kit/ndk"
import {ndk} from "@/utils/ndk"
import {KIND_REACTION, KIND_REPOST} from "@/utils/constants"
import {getTag} from "@/utils/nostr"
import {PopularityFilters} from "./usePopularityFilters"
import {useSocialGraphLoaded} from "@/utils/socialGraph"
import {seenEventIds} from "@/utils/memcache"

const LOW_THRESHOLD = 20

interface ReactionSubscriptionCache {
  pendingReactionCounts?: Map<string, Set<string>>
  showingReactionCounts?: Map<string, Set<string>>
}

export default function useReactionSubscription(
  currentFilters: PopularityFilters,
  expandFilters: () => void,
  cache: ReactionSubscriptionCache,
  filterSeen?: boolean
) {
  const isSocialGraphLoaded = useSocialGraphLoaded()
  const showingReactionCounts = useRef<Map<string, Set<string>>>(new Map())
  const pendingReactionCounts = useRef<Map<string, Set<string>>>(new Map())

  useEffect(() => {
    if (cache.pendingReactionCounts) {
      pendingReactionCounts.current = cache.pendingReactionCounts
    }
    if (cache.showingReactionCounts) {
      showingReactionCounts.current = cache.showingReactionCounts
    }
  }, [])

  useEffect(() => {
    if (!isSocialGraphLoaded) {
      return
    }

    const {timeRange, limit, authors: filterAuthors} = currentFilters
    const now = Math.floor(Date.now() / 1000)
    const since = now - timeRange

    const reactionFilter: NDKFilter = {
      kinds: [KIND_REACTION, KIND_REPOST],
      since,
      authors: filterAuthors,
      limit,
    }

    const sub = ndk().subscribe(reactionFilter)

    sub.on("event", (event) => {
      if (event.kind !== KIND_REACTION) return

      const originalPostId = getTag("e", event.tags)

      if (!originalPostId) return

      if (filterSeen && seenEventIds.has(originalPostId)) return

      if (showingReactionCounts.current.has(originalPostId)) {
        showingReactionCounts.current.get(originalPostId)?.add(event.id)
      } else if (pendingReactionCounts.current.has(originalPostId)) {
        pendingReactionCounts.current.get(originalPostId)?.add(event.id)
      } else {
        pendingReactionCounts.current.set(originalPostId, new Set([event.id]))
      }

      cache.pendingReactionCounts = pendingReactionCounts.current
      cache.showingReactionCounts = showingReactionCounts.current
    })

    return () => sub.stop()
  }, [currentFilters, isSocialGraphLoaded])

  const getNextMostPopular = (n: number): string[] => {
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

    return top.map(([eventId]) => eventId)
  }

  return {
    getNextMostPopular,
  }
}
