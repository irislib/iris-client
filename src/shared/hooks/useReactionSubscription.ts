import {useEffect, useRef, useState} from "react"
import {EventFilter} from "@/lib/nostr"
import {nostr} from "@/utils/nostrClient"
import {KIND_REACTION, KIND_REPOST, DEBUG_NAMESPACES} from "@/utils/constants"
import {getTag} from "@/utils/nostr"
import {PopularityFilters} from "./usePopularityFilters"
import {seenEventIds} from "@/utils/memcache"
import {createDebugLogger} from "@/utils/createDebugLogger"
import type {AlgorithmicVisibilitySnapshot} from "@/utils/visibility"
import useCandidateRevision from "./useCandidateRevision"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

const LOW_THRESHOLD = 20

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
  const {revision, notify} = useCandidateRevision()
  const visibilityRef = useRef(visibilitySnapshot)
  visibilityRef.current = visibilitySnapshot
  const policyReady = !!visibilitySnapshot
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
    // Previously hidden signals can become eligible without reopening the
    // history query or clearing the posts the user is already reading.
    if (pendingReactionCounts.current.size > 0) notify()
  }, [visibilitySnapshot, notify])

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

    if (!ready || !policyReady) {
      return
    }

    if (filterAuthors.length === 0) {
      markInitialDataReady()
      return
    }

    log("[ReactionSubscription] Starting subscription, authors:", filterAuthors.length)

    const now = Math.floor(Date.now() / 1000)

    const reactionFilter: EventFilter = {
      kinds: [KIND_REACTION, KIND_REPOST],
      since,
      until: oldestEventAt.current || now,
      authors: filterAuthors,
      limit,
    }

    const sub = nostr().subscribe(reactionFilter)

    let signalCount = 0
    sub.on("event", (event) => {
      if (activeAuthorScope.current !== subscribedScope) return
      if (!event.created_at || !event.id) return
      if (event.kind !== KIND_REACTION && event.kind !== KIND_REPOST) return
      const originalPostId = getTag("e", event.tags)
      if (!originalPostId) return

      if (oldestEventAt.current === null || event.created_at < oldestEventAt.current) {
        oldestEventAt.current = event.created_at
      }

      signalCount++
      if (filterSeen && seenEventIds.has(originalPostId)) return
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
        notify()
      }

      if (pendingReactionCounts.current.size > 0) {
        markInitialDataReady()
      }
      cache.pendingReactionCounts = pendingReactionCounts.current
      cache.showingReactionCounts = showingReactionCounts.current
    })

    sub.on("eose", () => {
      if (pendingReactionCounts.current.size > 0) markInitialDataReady()
    })

    const expansionTimer = setInterval(() => {
      if (activeAuthorScope.current !== subscribedScope) return
      // Keep the initial read alive when no data has arrived yet.
      if (signalCount === 0) return
      if (pendingReactionCounts.current.size <= LOW_THRESHOLD) {
        expansionAttempts.current += 1
        if (expansionAttempts.current < 3) {
          expandFilters()
        }

        const hasReactions = pendingReactionCounts.current.size > 0
        if (hasReactions) {
          markInitialDataReady()
        }
      }
    }, 5000)

    return () => {
      clearInterval(expansionTimer)
      sub.stop()
    }
  }, [cache, currentFilters, expandFilters, filterSeen, policyReady])

  const getNextMostPopular = (n: number): string[] => {
    // Note: We don't call expandFilters() here to avoid triggering re-renders during data fetching
    // It will be called by the timeout in the subscription effect if needed

    const top = Array.from(pendingReactionCounts.current.entries())
      // Keep received signals, but only currently visible actors may rank a
      // post. This also applies mutes to signals received before a policy change.
      .map(([id, actors]) => ({
        id,
        actors,
        score: Array.from(actors).filter(
          (actor) => !visibilityRef.current?.shouldHideRecommendationUser(actor)
        ).length,
      }))
      .filter(({score}) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, n)

    top.forEach(({id, actors}) => {
      pendingReactionCounts.current.delete(id)
      showingReactionCounts.current.set(id, actors)
    })

    return top.map(({id}) => id)
  }

  return {
    getNextMostPopular,
    hasInitialData: activeAuthorScope.current === authorScope && hasInitialData,
    sourceKey: authorScope,
    revision,
  }
}
