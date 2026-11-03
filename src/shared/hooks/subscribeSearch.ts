import NostrClient, {
  AppEvent,
  CacheMode,
  type EventFilter,
  type EventSubscription,
} from "@/lib/nostr"
import {SearchPageCursor} from "./searchPagination"

export interface SearchProgress {
  loading: boolean
  canLoadMore: boolean
  oldestSearched?: number
}

const sourceFor = (cursor: SearchPageCursor, relayUrls?: string[]) => ({
  cursor,
  relayUrls,
  delegated: new Set<string>(),
  sub: undefined as EventSubscription | undefined,
  timer: undefined as ReturnType<typeof setTimeout> | undefined,
  retry: false,
  pending: true,
})

// Owned by one mounted query. Effect cleanup releases the subscriptions while
// retaining each source's completed or interrupted page for Back navigation.
export interface SearchSession {
  sources?: ReturnType<typeof sourceFor>[]
}

/** Bounded search batches keep independent text/tag/recent-note cursors. */
export function subscribeSearch(
  nostr: NostrClient,
  filters: EventFilter[],
  onEvent: (event: AppEvent) => void,
  needsMore: () => boolean,
  onProgress: (state: SearchProgress) => void,
  relayUrls?: string[],
  session: SearchSession = {}
) {
  const sources = (session.sources ??= filters.map((filter) =>
    sourceFor(new SearchPageCursor(filter), relayUrls)
  ))
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

  const run = (initial = false, automatic = false) => {
    if (stopped || loading) return
    const active = sources.filter((source) =>
      initial
        ? source.pending || source.retry
        : source.retry
          ? !(automatic && (source.delegated.size || source.cursor.current.search))
          : source.cursor.advance()
    )
    if (!active.length) {
      onProgress({
        loading: false,
        canLoadMore: sources.some((source) => source.retry || !!source.cursor.next()),
        oldestSearched: oldestSearched(),
      })
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
        // History timeouts are only an incomplete snapshot. Keep a slow text
        // index subscribed so its eventual matches are not cancelled and retried
        // before they can arrive. Explicit loadMore retries the same interval.
        if (!timedOut || !source.cursor.current.search) source.sub?.stop()
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
          queueMicrotask(() => run(false, true))
        } else {
          onProgress({loading: false, canLoadMore, oldestSearched: boundary})
        }
      }
      source.sub = nostr.subscribe(source.cursor.current, {
        relayUrls: source.relayUrls,
        cacheUsage: CacheMode.ONLY_RELAY,
        groupable: false,
        isolated: true,
      })
      source.sub.on("event", (event, relay, _sub, fromCache) => {
        if (stopped || (settled && !source.retry)) return
        if (!source.delegated.has(relay?.url))
          source.cursor.record(event, relay?.url, fromCache)
        onEvent(event)
      })
      source.sub.on("event:dup", (event, relay, _elapsed, _sub, fromCache) => {
        if (!stopped && (!settled || source.retry) && !source.delegated.has(relay?.url))
          source.cursor.record(event, relay?.url, fromCache)
      })
      source.sub.on("eose", () => {
        if (stopped || settled) return
        // Incomplete history is retryable; it must not advance past unseen posts.
        const completion = source.sub?.completion
        if (!textSources.length && completion?.complete === false) {
          // A failed relay must retry its original interval. Relays that actually
          // supplied this filter and completed it can continue independently.
          const incomplete = new Set(
            completion.sources.filter((s) => !s.complete).map((s) => s.id)
          )
          for (const {id, complete} of completion.sources) {
            if (!complete || incomplete.has(id) || incomplete.has("local-cache")) continue
            const cursor = source.cursor.takeRelay(id)
            if (!cursor) continue
            source.delegated.add(id)
            const scoped = sourceFor(cursor, [id])
            scoped.pending = false
            sources.push(scoped)
          }
        }
        settle(completion?.complete === false)
      })
      source.timer = setTimeout(() => settle(true), 15_000)
    }
  }

  run(true)
  return {
    loadMore(retryIncomplete = true) {
      pagesLeft = 3
      run(false, !retryIncomplete)
    },
    stop() {
      stopped = true
      for (const source of sources) {
        clearTimeout(source.timer)
        source.sub?.stop()
        source.sub = undefined
        source.timer = undefined
      }
    },
  }
}
