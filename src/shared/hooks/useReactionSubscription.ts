import {useEffect, useRef, useState} from "react"
import {NDKFilter} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"
import {KIND_REACTION, KIND_REPOST, DEBUG_NAMESPACES} from "@/utils/constants"
import {getTag} from "@/utils/nostr"
import {PopularityFilters} from "./usePopularityFilters"
import {seenEventIds} from "@/utils/memcache"
import {createDebugLogger} from "@/utils/createDebugLogger"
import type {AlgorithmicVisibilitySnapshot} from "@/utils/visibility"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

const LOW_THRESHOLD = 20
const INITIAL_DATA_THRESHOLD = 5

interface ReactionSubscriptionCache {
  authorScope?: string
  hasInitialData?: boolean
  pendingReactionCounts?: Map<string, Set<string>>
  showingReactionCounts?: Map<string, Set<string>>
}

export default function useReactionSubscription(
  currentFilters: PopularityFilters,
  expandFilters: () => void,
  cache: ReactionSubscriptionCache,
  visibilitySnapshot: AlgorithmicVisibilitySnapshot | null,
  filterSeen?: boolean
) {
  const authorScope = `${currentFilters.scopeKey}:${
    currentFilters.ready ? "ready" : "loading"
  }:${currentFilters.authors.join(",")}`
  const cacheMatchesScope = cache.authorScope === authorScope
  const showingReactionCounts = useRef<Map<string, Set<string>>>(
    cacheMatchesScope && cache.showingReactionCounts
      ? cache.showingReactionCounts
      : new Map()
  )
  const pendingReactionCounts = useRef<Map<string, Set<string>>>(
    cacheMatchesScope && cache.pendingReactionCounts
      ? cache.pendingReactionCounts
      : new Map()
  )
  const oldestEventAt = useRef<number | null>(null)
  const expansionAttempts = useRef(0)
  const [hasInitialData, setHasInitialData] = useState(
    cacheMatchesScope && (cache.hasInitialData || false)
  )
  const hasInitialDataRef = useRef(cacheMatchesScope && (cache.hasInitialData || false))
  const activeAuthorScope = useRef(authorScope)

  useEffect(() => {
    if (activeAuthorScope.current !== authorScope) {
      activeAuthorScope.current = authorScope
      pendingReactionCounts.current = new Map()
      showingReactionCounts.current = new Map()
      oldestEventAt.current = null
      expansionAttempts.current = 0
      hasInitialDataRef.current = false
      setHasInitialData(false)
    }

    cache.authorScope = authorScope
    cache.hasInitialData = hasInitialDataRef.current
    cache.pendingReactionCounts = pendingReactionCounts.current
    cache.showingReactionCounts = showingReactionCounts.current
  }, [authorScope, cache])

  useEffect(() => {
    const {since, limit, authors: filterAuthors, ready} = currentFilters
    const subscribedScope = authorScope

    const markInitialDataReady = () => {
      if (activeAuthorScope.current !== subscribedScope) return
      if (hasInitialDataRef.current) return
      hasInitialDataRef.current = true
      cache.hasInitialData = true
      setHasInitialData(true)
    }

    if (!ready || !visibilitySnapshot) {
      return
    }

    if (filterAuthors.length === 0) {
      markInitialDataReady()
      return
    }

    log("[ReactionSubscription] Starting subscription, authors:", filterAuthors.length)

    const now = Math.floor(Date.now() / 1000)

    const reactionFilter: NDKFilter = {
      kinds: [KIND_REACTION, KIND_REPOST],
      since,
      until: oldestEventAt.current || now,
      authors: filterAuthors,
      limit,
    }

    const sub = ndk().subscribe(reactionFilter)

    let signalCount = 0
    sub.on("event", (event) => {
      if (activeAuthorScope.current !== subscribedScope) return
      if (!event.created_at || !event.id) return
      if (event.kind !== KIND_REACTION && event.kind !== KIND_REPOST) return
      // Recommendation signals obey the same visibility policy as their UI.
      // In particular, unknown and overmuted engagement actors cannot rank a post.
      if (visibilitySnapshot.shouldHideRecommendationUser(event.pubkey)) return
      const originalPostId = getTag("e", event.tags)
      if (!originalPostId) return

      if (filterSeen && seenEventIds.has(originalPostId)) return

      if (oldestEventAt.current === null || event.created_at < oldestEventAt.current) {
        oldestEventAt.current = event.created_at
      }

      signalCount++
      if (signalCount <= 5) {
        log(
          `[ReactionSubscription] Signal ${signalCount} to post:`,
          originalPostId.slice(0, 8)
        )
      }

      if (showingReactionCounts.current.has(originalPostId)) {
        showingReactionCounts.current.get(originalPostId)?.add(event.pubkey)
      } else if (pendingReactionCounts.current.has(originalPostId)) {
        pendingReactionCounts.current.get(originalPostId)?.add(event.pubkey)
      } else {
        pendingReactionCounts.current.set(originalPostId, new Set([event.pubkey]))
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
      if (activeAuthorScope.current !== subscribedScope) return
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
  }, [cache, currentFilters, expandFilters, filterSeen, visibilitySnapshot])

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
    hasInitialData: activeAuthorScope.current === authorScope && hasInitialData,
    sourceKey: authorScope,
  }
}
