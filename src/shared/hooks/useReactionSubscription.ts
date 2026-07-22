import {useEffect, useRef, useState} from "react"
import {NDKFilter} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"
import {KIND_REACTION, KIND_REPOST, DEBUG_NAMESPACES} from "@/utils/constants"
import {getTag} from "@/utils/nostr"
import {PopularityFilters} from "./usePopularityFilters"
import {seenEventIds} from "@/utils/memcache"
import {createDebugLogger} from "@/utils/createDebugLogger"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

const LOW_THRESHOLD = 20
const INITIAL_DATA_THRESHOLD = 5

interface ReactionSubscriptionCache {
  hasInitialData?: boolean
  pendingReactionCounts?: Map<string, Set<string>>
  showingReactionCounts?: Map<string, Set<string>>
}

export default function useReactionSubscription(
  currentFilters: PopularityFilters,
  expandFilters: () => void,
  cache: ReactionSubscriptionCache,
  filterSeen?: boolean
) {
  const showingReactionCounts = useRef<Map<string, Set<string>>>(new Map())
  const pendingReactionCounts = useRef<Map<string, Set<string>>>(new Map())
  const oldestEventAt = useRef<number | null>(null)
  const expansionAttempts = useRef(0)
  const [hasInitialData, setHasInitialData] = useState(cache.hasInitialData || false)
  const hasInitialDataRef = useRef(cache.hasInitialData || false)

  useEffect(() => {
    if (cache.pendingReactionCounts) {
      pendingReactionCounts.current = cache.pendingReactionCounts
    }
    if (cache.showingReactionCounts) {
      showingReactionCounts.current = cache.showingReactionCounts
    }
  }, [])

  useEffect(() => {
    cache.hasInitialData = hasInitialData
  }, [hasInitialData, cache])

  useEffect(() => {
    const {since, limit, authors: filterAuthors} = currentFilters

    log(
      "[ReactionSubscription] Starting subscription, authors:",
      filterAuthors?.length || "undefined (match all)"
    )

    const now = Math.floor(Date.now() / 1000)

    const reactionFilter: NDKFilter = {
      kinds: [KIND_REACTION, KIND_REPOST],
      since,
      until: oldestEventAt.current || now,
      authors: filterAuthors,
      limit,
    }

    const sub = ndk().subscribe(reactionFilter)

    const markInitialDataReady = () => {
      if (hasInitialDataRef.current) return
      hasInitialDataRef.current = true
      cache.hasInitialData = true
      setHasInitialData(true)
    }

    let reactionCount = 0
    sub.on("event", (event) => {
      if (!event.created_at || !event.id) return
      if (event.kind !== KIND_REACTION) return
      const originalPostId = getTag("e", event.tags)
      if (!originalPostId) return

      if (filterSeen && seenEventIds.has(originalPostId)) return

      if (oldestEventAt.current === null || event.created_at < oldestEventAt.current) {
        oldestEventAt.current = event.created_at
      }

      reactionCount++
      if (reactionCount <= 5) {
        log(
          `[ReactionSubscription] Reaction ${reactionCount} to post:`,
          originalPostId.slice(0, 8)
        )
      }

      if (showingReactionCounts.current.has(originalPostId)) {
        showingReactionCounts.current.get(originalPostId)?.add(event.id)
      } else if (pendingReactionCounts.current.has(originalPostId)) {
        pendingReactionCounts.current.get(originalPostId)?.add(event.id)
      } else {
        pendingReactionCounts.current.set(originalPostId, new Set([event.id]))
      }

      if (
        !hasInitialDataRef.current &&
        pendingReactionCounts.current.size >= INITIAL_DATA_THRESHOLD
      ) {
        markInitialDataReady()
      }
      cache.pendingReactionCounts = pendingReactionCounts.current
      cache.showingReactionCounts = showingReactionCounts.current
    })

    const timeout = setTimeout(() => {
      if (pendingReactionCounts.current.size <= LOW_THRESHOLD) {
        expansionAttempts.current += 1
        if (expansionAttempts.current < 3) {
          expandFilters()
        }

        const hasReactions = pendingReactionCounts.current.size > 0
        const exhaustedInitialWindows = expansionAttempts.current >= 3

        // For You can fall back to its chronological source immediately. Popular
        // must survive a cold social-graph load instead of declaring itself empty
        // before its author list and reactions arrive.
        if (filterSeen || hasReactions || exhaustedInitialWindows) {
          markInitialDataReady()
        }
      }
    }, 5000)

    return () => {
      clearTimeout(timeout)
      sub.stop()
    }
  }, [cache, currentFilters, expandFilters, filterSeen])

  const getNextMostPopular = (n: number): string[] => {
    // Note: We don't call expandFilters() here to avoid triggering re-renders during data fetching
    // It will be called by the timeout in the subscription effect if needed

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
    hasInitialData,
  }
}
