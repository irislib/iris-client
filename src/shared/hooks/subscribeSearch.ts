import NDK, {NDKEvent, type NDKFilter, type NDKSubscription} from "@/lib/ndk"
import {SearchPageCursor} from "./searchPagination"

export interface SearchProgress {
  loading: boolean
  canLoadMore: boolean
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
        if (--pending) return
        loading = false
        const canLoadMore = sources.some((source) => !!source.cursor.next())
        if (canLoadMore && pagesLeft > 0 && needsMore()) {
          queueMicrotask(() => run())
        } else {
          onProgress({loading: false, canLoadMore})
        }
      }
      source.sub = ndk.subscribe(source.cursor.current, {
        relayUrls,
        groupable: false,
        isolated: true,
      })
      source.sub.on("event", (event, relay, _sub, fromCache) => {
        if (stopped) return
        source.cursor.record(event, relay?.url, fromCache)
        onEvent(event)
      })
      source.sub.on("event:dup", (event, relay, _elapsed, _sub, fromCache) => {
        if (!stopped) source.cursor.record(event, relay?.url, fromCache)
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
