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
  }))
  let stopped = false
  let loading = false
  let pagesLeft = 3

  const run = (initial = false) => {
    if (stopped || loading) return
    const active = sources.filter((source) => initial || source.cursor.advance())
    if (!active.length) {
      onProgress({loading: false, canLoadMore: false})
      return
    }
    loading = true
    pagesLeft--
    let pending = active.length
    onProgress({loading: true, canLoadMore: false})
    for (const source of active) {
      source.sub?.stop()
      clearTimeout(source.timer)
      let settled = false
      const settle = () => {
        if (stopped || settled) return
        settled = true
        clearTimeout(source.timer)
        source.sub?.stop()
        if (--pending) return
        loading = false
        const canLoadMore = sources.some((source) => !!source.cursor.next())
        // Cached/tag matches can be much older than the history searched by
        // the text indexes. Do not present those as the next results yet.
        const textSources = sources.filter((source) => source.cursor.current.search)
        const oldestSearched = Math.max(
          0,
          ...(textSources.length ? textSources : sources).map(
            (source) => source.cursor.next()?.until ?? 0
          )
        )
        onProgress({loading: true, canLoadMore: false, oldestSearched})
        if (canLoadMore && pagesLeft > 0 && needsMore()) {
          queueMicrotask(() => run())
        } else {
          onProgress({loading: false, canLoadMore, oldestSearched})
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
      source.sub.on("eose", settle)
      source.timer = setTimeout(settle, 5000)
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
