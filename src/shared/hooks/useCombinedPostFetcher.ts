import {useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo} from "react"
import {AppEvent, EventFilter} from "@/lib/nostr"
import {addSeenEventId, seenEventIds} from "@/utils/memcache"
import shuffle from "lodash/shuffle"
import {
  appendDiverseAuthors,
  avoidConsecutiveAuthors,
  selectNonConsecutiveAuthors,
} from "@/utils/authorDiversity"
import {useUserStore} from "@/stores/user"
import {fetchEventsReliable} from "@/utils/fetchEventsReliable"
import type {AlgorithmicVisibilitySnapshot} from "@/utils/visibility"
import {isFeedReply} from "@/utils/feedReplies"

interface CombinedPostFetcherCache {
  scopeKey?: string
  events?: AppEvent[]
  hasLoadedInitial?: boolean
  completedInitialSources?: number
}

interface CombinedPostFetcherProps {
  getNextPopular: (n: number) => string[]
  getNextChronological: (n: number) => string[]
  hasPopularData: boolean
  hasChronologicalData: boolean
  cache: CombinedPostFetcherCache
  sourceKey: string
  candidateRevision?: string
  ready: boolean
  visibilitySnapshot: AlgorithmicVisibilitySnapshot | null
  popularRatio?: number
  excludeOwnPosts?: boolean
  excludeReplies?: boolean
  enforceAuthorDiversity?: boolean
  discoveryEnabled?: boolean
  discoveryReady?: boolean
  discoveryPosts?: AppEvent[]
}

export default function useCombinedPostFetcher({
  getNextPopular,
  getNextChronological,
  hasPopularData,
  hasChronologicalData,
  cache,
  sourceKey,
  candidateRevision = "",
  ready,
  visibilitySnapshot,
  popularRatio = 0.5,
  excludeOwnPosts = false,
  excludeReplies = false,
  enforceAuthorDiversity = false,
  discoveryEnabled = false,
  discoveryReady = false,
  discoveryPosts = [],
}: CombinedPostFetcherProps) {
  const [events, setEvents] = useState<AppEvent[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const hasLoadedInitial = useRef(false)
  const myPubKey = useUserStore((state) => state.publicKey)
  const isLoadingRef = useRef(false)
  const initialRequestsRef = useRef(0)
  const initialSourcesRef = useRef(0)
  const completedInitialSourcesRef = useRef(0)
  const consumedDiscoveryRef = useRef(new Set<string>())
  const generationRef = useRef(0)
  const activeScopeRef = useRef<string | null>(null)
  const attemptedReadinessRef = useRef<string | null>(null)
  const scopeKey = `${myPubKey || "anonymous"}:${sourceKey}${excludeReplies ? ":top-level" : ""}`
  const policyReady = ready && !!visibilitySnapshot
  const visibilityRef = useRef(visibilitySnapshot)
  visibilityRef.current = visibilitySnapshot
  // Keep deferred posts in the collection/cache, but only render and mark seen
  // the diverse selection. Apply this after moderation, which can remove separators.
  const visibleEvents = useMemo(() => {
    const visible = events.filter(
      (event) =>
        !(excludeReplies && isFeedReply(event)) &&
        !visibilitySnapshot?.shouldHideAlgorithmicEvent(event)
    )
    return enforceAuthorDiversity ? selectNonConsecutiveAuthors(visible) : visible
  }, [events, visibilitySnapshot, enforceAuthorDiversity, excludeReplies])
  const normalizedPopularRatio = Math.min(1, Math.max(0, popularRatio))
  const popularSourceEnabled = normalizedPopularRatio > 0
  const chronologicalSourceEnabled = normalizedPopularRatio < 1
  const popularSourceReady = popularSourceEnabled && hasPopularData
  const chronologicalSourceReady = chronologicalSourceEnabled && hasChronologicalData
  const hasAnySourceReady =
    popularSourceReady || chronologicalSourceReady || discoveryReady
  const allEnabledSourcesReady =
    discoveryReady ||
    ((!popularSourceEnabled || popularSourceReady) &&
      (!chronologicalSourceEnabled || chronologicalSourceReady))
  const availableSources =
    (popularSourceReady ? 1 : 0) |
    (chronologicalSourceReady ? 2 : 0) |
    (discoveryReady ? 4 : 0)
  const sourceReadinessKey = `${popularSourceReady}:${chronologicalSourceReady}:${discoveryReady}:${candidateRevision}`

  useLayoutEffect(() => {
    if (!policyReady || !visibilitySnapshot) {
      if (activeScopeRef.current !== null) {
        generationRef.current += 1
        activeScopeRef.current = null
        hasLoadedInitial.current = false
        isLoadingRef.current = false
        initialRequestsRef.current = 0
        initialSourcesRef.current = 0
        completedInitialSourcesRef.current = 0
        consumedDiscoveryRef.current = new Set()
        attemptedReadinessRef.current = null
        setEvents([])
        setLoading(false)
      }
      return
    }

    if (activeScopeRef.current === scopeKey) return

    generationRef.current += 1
    activeScopeRef.current = scopeKey
    isLoadingRef.current = false
    initialRequestsRef.current = 0
    initialSourcesRef.current = 0
    consumedDiscoveryRef.current = new Set()
    attemptedReadinessRef.current = null

    const cacheMatchesScope = cache.scopeKey === scopeKey
    completedInitialSourcesRef.current = cacheMatchesScope
      ? cache.completedInitialSources || 0
      : 0
    const eligibleCachedEvents = cacheMatchesScope
      ? (cache.events || []).filter(
          (event) =>
            !(excludeReplies && isFeedReply(event)) &&
            !visibilitySnapshot.shouldHideAlgorithmicEvent(event)
        )
      : []
    const cachedEvents = enforceAuthorDiversity
      ? eligibleCachedEvents
      : avoidConsecutiveAuthors(eligibleCachedEvents)

    cache.scopeKey = scopeKey
    cache.events = cachedEvents
    hasLoadedInitial.current = cacheMatchesScope && !!cache.hasLoadedInitial
    cache.hasLoadedInitial = hasLoadedInitial.current
    cache.completedInitialSources = completedInitialSourcesRef.current
    setEvents(cachedEvents)
    setLoading(false)
  }, [
    cache,
    policyReady,
    scopeKey,
    visibilitySnapshot,
    enforceAuthorDiversity,
    excludeReplies,
  ])

  useEffect(() => {
    if (!policyReady) return
    visibleEvents.forEach((event) => {
      if (!seenEventIds.has(event.id)) addSeenEventId(event.id)
    })
  }, [policyReady, visibleEvents])

  const appendEvents = useCallback(
    (newEvents: AppEvent[]) => {
      setEvents((previous) => {
        const existing = new Set(previous.map((event) => event.id))
        const incoming = newEvents.filter((event) => !existing.has(event.id))
        if (incoming.length === 0) return previous
        return enforceAuthorDiversity
          ? appendDiverseAuthors(
              previous,
              incoming,
              (event) => !!visibilityRef.current?.shouldHideAlgorithmicEvent(event)
            )
          : [...previous, ...avoidConsecutiveAuthors(incoming, previous.at(-1)?.pubkey)]
      })
    },
    [enforceAuthorDiversity]
  )

  useEffect(() => {
    if (activeScopeRef.current !== scopeKey) return
    cache.events = events
  }, [events, cache, scopeKey])

  useEffect(() => {
    cache.hasLoadedInitial = hasLoadedInitial.current
  }, [cache])

  const loadBatch = useCallback(
    async (batchSize: number = 10, claimed?: {sources: number}) => {
      if (!visibilitySnapshot) return []
      const generation = generationRef.current

      const takeDiscovery = (count: number) => {
        if (!discoveryReady || count <= 0) return []
        if (claimed && initialSourcesRef.current & 4 && !(claimed.sources & 4)) return []
        if (claimed) {
          claimed.sources |= 4
          initialSourcesRef.current |= 4
        }
        const selected: AppEvent[] = []
        const displayed = new Set((cache.events || []).map((event) => event.id))
        for (const event of discoveryPosts) {
          if (
            consumedDiscoveryRef.current.has(event.id) ||
            displayed.has(event.id) ||
            seenEventIds.has(event.id) ||
            (excludeOwnPosts && event.pubkey === myPubKey) ||
            (excludeReplies && isFeedReply(event)) ||
            visibilityRef.current?.shouldHideAlgorithmicEvent(event)
          )
            continue
          consumedDiscoveryRef.current.add(event.id)
          selected.push(event)
          if (selected.length === count) break
        }
        return selected
      }

      // Recommended IDs do not reveal whether their posts are replies. Refill
      // empty filtered pages, capped at five batches per call for reply-only
      // pools. Missing bodies do not trigger extra refills.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const popularCount = Math.floor(batchSize * normalizedPopularRatio)
        const chronologicalCount = batchSize - popularCount

        const allIds: string[] = []
        const seenIds = new Set<string>()
        const appendIds = (ids: string[]) => {
          for (const id of ids) {
            if (seenIds.has(id) || allIds.length >= batchSize) continue
            seenIds.add(id)
            allIds.push(id)
          }
        }
        const takePopular = (count: number) => {
          if (claimed && initialSourcesRef.current & 1 && !(claimed.sources & 1)) return
          if (count > 0 && popularSourceReady) {
            const before = allIds.length
            appendIds(getNextPopular(count))
            if (claimed && allIds.length > before) {
              claimed.sources |= 1
              initialSourcesRef.current |= 1
            }
          }
        }
        const takeChronological = (count: number) => {
          if (claimed && initialSourcesRef.current & 2 && !(claimed.sources & 2)) return
          if (count > 0 && chronologicalSourceReady) {
            const before = allIds.length
            appendIds(getNextChronological(count))
            if (claimed && allIds.length > before) {
              claimed.sources |= 2
              initialSourcesRef.current |= 2
            }
          }
        }

        takePopular(popularCount)
        takeChronological(chronologicalCount)

        // Let either ready source fill space left by an unavailable or exhausted
        // source. Disabled sources are never called, including Chronological in
        // the popular-only feed.
        takePopular(batchSize - allIds.length)
        takeChronological(batchSize - allIds.length)

        if (allIds.length === 0) {
          return takeDiscovery(batchSize)
        }
        const postFilter: EventFilter = {
          ids: allIds,
        }

        const {promise} = fetchEventsReliable(postFilter, {
          timeout: 4000,
          settleAfterMs: 300,
        })
        let eventsArray = await promise
        if (generation !== generationRef.current) return []

        const fetchedCount = eventsArray.length
        if (excludeOwnPosts && myPubKey) {
          eventsArray = eventsArray.filter((event) => event.pubkey !== myPubKey)
        }

        const removedReplies = excludeReplies && eventsArray.some(isFeedReply)
        eventsArray = eventsArray.filter(
          (event) =>
            !(excludeReplies && isFeedReply(event)) &&
            !visibilityRef.current?.shouldHideAlgorithmicEvent(event)
        )

        const removedOriginals = fetchedCount > eventsArray.length
        if (
          eventsArray.length === 0 &&
          (removedReplies || (discoveryEnabled && removedOriginals))
        )
          continue
        const original = shuffle(eventsArray)
        // Render a usable original batch immediately. A later bounded refill
        // drains ready original candidates before discovery fills the deficit.
        for (const event of original) consumedDiscoveryRef.current.add(event.id)
        return original.length ? original : takeDiscovery(batchSize)
      }
      return takeDiscovery(batchSize)
    },
    [
      getNextPopular,
      getNextChronological,
      normalizedPopularRatio,
      popularSourceReady,
      chronologicalSourceReady,
      myPubKey,
      excludeOwnPosts,
      excludeReplies,
      visibilitySnapshot,
      cache,
      discoveryReady,
      discoveryPosts,
      discoveryEnabled,
    ]
  )

  const loadInitial = useCallback(async () => {
    const uncompleted = availableSources & ~completedInitialSourcesRef.current
    const needsInitialOriginals = !!(uncompleted & 3)
    const needsDiscoveryFill = !!(uncompleted & 4) && events.length < 10
    const attemptKey = `${sourceReadinessKey}:${discoveryEnabled ? events.length : ""}`
    if (
      !policyReady ||
      (isLoadingRef.current && initialRequestsRef.current === 0) ||
      initialRequestsRef.current >=
        (popularSourceEnabled && chronologicalSourceEnabled ? 2 : 1) +
          (discoveryEnabled ? 1 : 0) ||
      (hasLoadedInitial.current &&
        events.length > 0 &&
        (!discoveryEnabled || (!needsInitialOriginals && !needsDiscoveryFill))) ||
      attemptedReadinessRef.current === attemptKey
    ) {
      return
    }
    attemptedReadinessRef.current = attemptKey
    const generation = generationRef.current
    // Reserve each source only when it supplies IDs. A stream of unavailable
    // recommendations cannot occupy both slots and block healthy chronology.
    const claimed = {sources: 0}
    initialRequestsRef.current += 1
    isLoadingRef.current = true
    setLoading(true)
    let shouldFinalize = false

    try {
      const batchSize =
        hasLoadedInitial.current && !needsInitialOriginals
          ? Math.max(0, 10 - events.length)
          : 10
      let newEvents = await loadBatch(batchSize, claimed)
      if (generation !== generationRef.current) return
      if (newEvents.length === 0 && !hasLoadedInitial.current) {
        newEvents = await loadBatch(10, claimed)
      }
      if (generation !== generationRef.current) return

      if (newEvents.length > 0) {
        // A newly ready source can fill the feed while an earlier ID query is
        // still waiting. Late results append without replacing the visible page.
        appendEvents(newEvents)
        shouldFinalize = true
      } else if (newEvents.length === 0 && allEnabledSourcesReady) {
        shouldFinalize = true
      }
    } catch {
      // Relay failures are expected; a later load can recover without leaving
      // an unhandled rejection or a permanent spinner.
      shouldFinalize = allEnabledSourcesReady
    } finally {
      // Relay or cache failures must never leave the feed in a permanent spinner.
      if (generation === generationRef.current) {
        initialSourcesRef.current &= ~claimed.sources
        completedInitialSourcesRef.current |= claimed.sources
        cache.completedInitialSources = completedInitialSourcesRef.current
        if (shouldFinalize) {
          hasLoadedInitial.current = true
          cache.hasLoadedInitial = true
        }
        initialRequestsRef.current -= 1
        isLoadingRef.current = initialRequestsRef.current > 0
        setLoading(isLoadingRef.current)
      }
    }
  }, [
    allEnabledSourcesReady,
    appendEvents,
    cache,
    events.length,
    loadBatch,
    policyReady,
    popularSourceEnabled,
    chronologicalSourceEnabled,
    sourceReadinessKey,
    availableSources,
    discoveryEnabled,
  ])

  const loadMore = useCallback(async () => {
    if (!policyReady || !hasAnySourceReady || isLoadingRef.current) {
      return
    }

    const generation = generationRef.current
    isLoadingRef.current = true
    setLoading(true)

    try {
      const newEvents = await loadBatch(10)

      if (newEvents.length === 0) {
        return
      }

      if (generation !== generationRef.current) return

      appendEvents(newEvents)
    } catch {
      // Keep the current feed when relays are temporarily unavailable.
    } finally {
      if (generation === generationRef.current) {
        isLoadingRef.current = false
        setLoading(false)
      }
    }
  }, [appendEvents, hasAnySourceReady, loadBatch, policyReady])

  useEffect(() => {
    if (
      !policyReady ||
      !hasAnySourceReady ||
      (hasLoadedInitial.current && events.length > 0 && !discoveryEnabled)
    ) {
      return
    }

    void loadInitial()
  }, [
    events.length,
    hasAnySourceReady,
    loadInitial,
    loading,
    policyReady,
    discoveryEnabled,
  ])

  const isInitializing = policyReady && !hasLoadedInitial.current && hasAnySourceReady
  const waitingForDataSources =
    policyReady && !hasLoadedInitial.current && !hasAnySourceReady

  return {
    events: policyReady ? visibleEvents : [],
    loading: !policyReady || loading || isInitializing || waitingForDataSources,
    loadMore,
    loadMoreKey: `${scopeKey}:${sourceReadinessKey}:${events.length}`,
  }
}
