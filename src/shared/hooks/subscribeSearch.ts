import NDK, {
  NDKEvent,
  NDKSubscriptionCacheUsage,
  type NDKFilter,
  type NDKSubscription,
} from "@/lib/ndk"
import {SearchPageCursor} from "./searchPagination"

export interface SearchProgress {
  loading: boolean
  canLoadMore: boolean
  oldestSearched?: number
}

/** Bounded search batches keep independent text/tag/recent-note cursors. */
export function subscribeSearch(
  ndk: NDK,
  filters: NDKFilter[],
  onEvent: (event: NDKEvent) => void,
  needsMore: () => boolean,
  onProgress: (state: SearchProgress) => void,
  relayUrls?: string[]
) {
  const sources = filters.map((filter) => ({
    cursor: new SearchPageCursor(filter),
    sub: undefined as NDKSubscription | undefined,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    retry: false,
    pending: true,
  }))
  const textSources = sources.filter((source) => source.cursor.current.search)
  // Every AND match contains each individual word. The index that has searched
  // furthest back covers that interval on its own. A phrase index may omit
  // different word orders, so only individual terms determine this boundary.
  const wordSources = textSources.filter(
    (source) => !/\s/.test(source.cursor.current.search!.trim())
  )
  const indexSources = wordSources.length ? wordSources : textSources
  const boundarySources = indexSources.length ? indexSources : sources
  const oldestSearched = () => {
    const boundaries = boundarySources.map(
      (source) =>
        // Pending/interrupted pages have not proven their interval complete.
        (source.pending || source.retry
          ? source.cursor.current.until
          : source.cursor.next()?.until) ?? 0
    )
    return textSources.length ? Math.min(...boundaries) : Math.max(0, ...boundaries)
  }
  let stopped = false
  let loading = false
  let pagesLeft = 3

  const run = (initial = false) => {
    if (stopped || loading) return
    const active = sources.filter(
      (source) => initial || source.retry || source.cursor.advance()
    )
    if (!active.length) {
      onProgress({loading: false, canLoadMore: false})
      return
    }
    loading = true
    pagesLeft--
    let pending = active.length
    for (const source of active) source.pending = true
    onProgress({loading: true, canLoadMore: false})
    for (const source of active) {
      source.sub?.stop()
      clearTimeout(source.timer)
      let settled = false
      const settle = (timedOut = false) => {
        if (stopped || settled) return
        settled = true
        source.retry = timedOut
        source.pending = false
        clearTimeout(source.timer)
        source.sub?.stop()
        const boundary = oldestSearched()
        // Publish completed text intervals immediately, while other relays or
        // less selective term indexes are still working on this batch.
        onProgress({loading: true, canLoadMore: false, oldestSearched: boundary})
        if (--pending) return
        loading = false
        const canLoadMore = sources.some(
          (source) => source.retry || !!source.cursor.next()
        )
        if (canLoadMore && pagesLeft > 0 && needsMore()) {
          queueMicrotask(() => run())
        } else {
          onProgress({loading: false, canLoadMore, oldestSearched: boundary})
        }
      }
      source.sub = ndk.subscribe(source.cursor.current, {
        relayUrls,
        // The worker routes text queries to the search index. Main-thread
        // relay/cache EOSEs must not finish that request before it answers.
        transports: ["worker-transport"],
        cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
        groupable: false,
        isolated: true,
      })
      source.sub.on("event", (event, relay, _sub, fromCache) => {
        if (stopped || settled) return
        source.cursor.record(event, relay?.url, fromCache)
        onEvent(event)
      })
      source.sub.on("event:dup", (event, relay, _elapsed, _sub, fromCache) => {
        if (!stopped && !settled) source.cursor.record(event, relay?.url, fromCache)
      })
      source.sub.on("eose", () => settle())
      source.timer = setTimeout(() => settle(true), 15_000)
    }
  }

  run(true)
  return {
    loadMore() {
      pagesLeft = 3
      run()
    },
    stop() {
      stopped = true
      for (const source of sources) {
        clearTimeout(source.timer)
        source.sub?.stop()
      }
    },
  }
}
