import {useState, useEffect, useRef, useCallback, useLayoutEffect} from "react"
import {NDKEvent, NDKFilter} from "@/lib/ndk"
import {addSeenEventId} from "@/utils/memcache"
import shuffle from "lodash/shuffle"
import {useUserStore} from "@/stores/user"
import {fetchEventsReliable} from "@/utils/fetchEventsReliable"
import type {AlgorithmicVisibilitySnapshot} from "@/utils/visibility"

interface CombinedPostFetcherCache {
  scopeKey?: string
  events?: NDKEvent[]
  hasLoadedInitial?: boolean
}

interface CombinedPostFetcherProps {
  getNextPopular: (n: number) => string[]
  getNextChronological: (n: number) => string[]
  hasPopularData: boolean
  hasChronologicalData: boolean
  cache: CombinedPostFetcherCache
  sourceKey: string
  ready: boolean
  visibilitySnapshot: AlgorithmicVisibilitySnapshot | null
  popularRatio?: number
  excludeOwnPosts?: boolean
}

export default function useCombinedPostFetcher({
  getNextPopular,
  getNextChronological,
  hasPopularData,
  hasChronologicalData,
  cache,
  sourceKey,
  ready,
  visibilitySnapshot,
  popularRatio = 0.5,
  excludeOwnPosts = false,
}: CombinedPostFetcherProps) {
  const [events, setEvents] = useState<NDKEvent[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const hasLoadedInitial = useRef(false)
  const myPubKey = useUserStore((state) => state.publicKey)
  const isLoadingRef = useRef(false)
  const generationRef = useRef(0)
  const activeScopeRef = useRef<string | null>(null)
  const attemptedReadinessRef = useRef<string | null>(null)
  const scopeKey = `${myPubKey || "anonymous"}:${sourceKey}`
  const policyReady = ready && !!visibilitySnapshot
  const normalizedPopularRatio = Math.min(1, Math.max(0, popularRatio))
  const popularSourceEnabled = normalizedPopularRatio > 0
  const chronologicalSourceEnabled = normalizedPopularRatio < 1
  const popularSourceReady = popularSourceEnabled && hasPopularData
  const chronologicalSourceReady = chronologicalSourceEnabled && hasChronologicalData
  const hasAnySourceReady = popularSourceReady || chronologicalSourceReady
  const allEnabledSourcesReady =
    (!popularSourceEnabled || popularSourceReady) &&
    (!chronologicalSourceEnabled || chronologicalSourceReady)
  const sourceReadinessKey = `${popularSourceReady}:${chronologicalSourceReady}`

  useLayoutEffect(() => {
    if (!policyReady || !visibilitySnapshot) {
      if (activeScopeRef.current !== null) {
        generationRef.current += 1
        activeScopeRef.current = null
        hasLoadedInitial.current = false
        isLoadingRef.current = false
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
    attemptedReadinessRef.current = null

    const cacheMatchesScope = cache.scopeKey === scopeKey
    const cachedEvents = cacheMatchesScope
      ? (cache.events || []).filter(
          (event) => !visibilitySnapshot.shouldHideAlgorithmicEvent(event)
        )
      : []

    cache.scopeKey = scopeKey
    cache.events = cachedEvents
    hasLoadedInitial.current = cacheMatchesScope && !!cache.hasLoadedInitial
    cache.hasLoadedInitial = hasLoadedInitial.current
    setEvents(cachedEvents)
    setLoading(false)
  }, [cache, policyReady, scopeKey, visibilitySnapshot])

  useEffect(() => {
    if (activeScopeRef.current !== scopeKey) return
    cache.events = events
  }, [events, cache, scopeKey])

  useEffect(() => {
    cache.hasLoadedInitial = hasLoadedInitial.current
  }, [cache])

  const loadBatch = useCallback(
    async (batchSize: number = 10) => {
      if (!visibilitySnapshot) return []

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
        if (count > 0 && popularSourceReady) {
          appendIds(getNextPopular(count))
        }
      }
      const takeChronological = (count: number) => {
        if (count > 0 && chronologicalSourceReady) {
          appendIds(getNextChronological(count))
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

      eventsArray = eventsArray.filter(
        (event) => !visibilitySnapshot.shouldHideAlgorithmicEvent(event)
      )

      const shuffledEvents = shuffle(eventsArray)
      return shuffledEvents
    },
    [
      getNextPopular,
      getNextChronological,
      normalizedPopularRatio,
      popularSourceReady,
      chronologicalSourceReady,
      myPubKey,
      excludeOwnPosts,
      visibilitySnapshot,
    ]
  )

  const loadInitial = useCallback(async () => {
    if (
      !policyReady ||
      isLoadingRef.current ||
      hasLoadedInitial.current ||
      attemptedReadinessRef.current === sourceReadinessKey
    ) {
      return
    }
    attemptedReadinessRef.current = sourceReadinessKey
    const generation = generationRef.current
    isLoadingRef.current = true
    setLoading(true)
    let shouldFinalize = false

    try {
      let newEvents = await loadBatch(10)
      if (newEvents.length === 0) {
        newEvents = await loadBatch(10)
      }

      if (generation === generationRef.current && newEvents.length > 0) {
        newEvents.forEach((event) => addSeenEventId(event.id))
        setEvents(newEvents)
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
        if (shouldFinalize) {
          hasLoadedInitial.current = true
          cache.hasLoadedInitial = true
        }
        isLoadingRef.current = false
        setLoading(false)
      }
    }
  }, [allEnabledSourcesReady, cache, loadBatch, policyReady, sourceReadinessKey])

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
      if (generation === generationRef.current) {
        isLoadingRef.current = false
        setLoading(false)
      }
    }
  }, [hasAnySourceReady, loadBatch, policyReady])

  useEffect(() => {
    if (!policyReady || !hasAnySourceReady || hasLoadedInitial.current || loading) {
      return
    }

    void loadInitial()
  }, [hasAnySourceReady, loadInitial, loading, policyReady])

  const isInitializing = policyReady && !hasLoadedInitial.current && hasAnySourceReady
  const waitingForDataSources =
    policyReady && !hasLoadedInitial.current && !hasAnySourceReady

  return {
    events: policyReady ? events : [],
    loading: !policyReady || loading || isInitializing || waitingForDataSources,
    loadMore,
  }
}
