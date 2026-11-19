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
  // Its current page is on the wire, whether or not a batch still waits for it.
  running: false,
})

type Source = ReturnType<typeof sourceFor>

// Owned by one mounted query. Effect cleanup releases the subscriptions while
// retaining each source's completed or interrupted page for Back navigation.
export interface SearchSession {
  sources?: Source[]
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
  // Text indexes answer as one source; plain relay history is paged per relay.
  const perRelay = !textSources.length
  // Relays paged one at a time need more turns than indexes answering together.
  const pageBudget = perRelay ? 9 : 3
  let stopped = false
  let loading = false
  let pagesLeft = pageBudget

  /** Continue one relay from its own finished page, independently of the rest. */
  const delegate = (source: Source, url: string) => {
    const cursor = source.cursor.takeRelay(url)
    if (!cursor) return false
    source.delegated.add(url)
    const scoped = sourceFor(cursor, [url])
    scoped.pending = false
    sources.push(scoped)
    return true
  }

  const hasMore = () =>
    sources.some((source) => source.retry || (!source.pending && !!source.cursor.next()))

  const report = () => {
    const canLoadMore = hasMore()
    onProgress({
      // A relay still answering behind its batch may yet add pages.
      loading: !canLoadMore && sources.some((source) => source.running),
      canLoadMore,
      oldestSearched: oldestSearched(),
    })
  }

  // No batch is being waited for: fetch the next page or say where things stand.
  const proceed = () => {
    if (hasMore() && pagesLeft > 0 && needsMore()) queueMicrotask(() => run(false, true))
    else report()
  }

  const run = (initial = false, automatic = false) => {
    if (stopped || loading) return
    const active = sources.filter((source) => {
      if (source.running) return false
      if (initial) return source.pending || source.retry
      return source.retry
        ? !(automatic && (source.delegated.size || source.cursor.current.search))
        : source.cursor.advance()
    })
    if (!active.length) {
      report()
      return
    }
    // A retried page can spend its whole timeout on an unreachable relay.
    // Relays that are ready for their next page do not wait for it.
    const ready = active.filter((source) => !source.retry)
    const awaited = new Set(perRelay && ready.length ? ready : active)
    let waiting = awaited.size
    let open = true
    loading = true
    pagesLeft--
    for (const source of active) {
      source.pending = true
      source.running = true
    }
    onProgress({loading: true, canLoadMore: false})
    for (const source of active) {
      source.sub?.stop()
      clearTimeout(source.timer)
      let settled = false
      let holding = awaited.has(source)
      // This source no longer holds the batch, though it may still be answering.
      const leave = (advanced: boolean) => {
        if (!holding || !open) return
        holding = false
        // One relay with a new page is enough to go on; slower ones catch up.
        if (--waiting && !(perRelay && advanced)) return
        open = false
        loading = false
        proceed()
      }
      const settle = (timedOut = false) => {
        if (stopped || settled) return
        settled = true
        source.running = false
        source.retry = timedOut
        source.pending = false
        clearTimeout(source.timer)
        // History timeouts are only an incomplete snapshot. Keep a slow text
        // index subscribed so its eventual matches are not cancelled and retried
        // before they can arrive. Explicit loadMore retries the same interval.
        if (!timedOut || !source.cursor.current.search) source.sub?.stop()
        if (!open) {
          // Answered behind its batch: pick it up unless another one is loading.
          if (!loading) proceed()
        } else if (holding) {
          // Publish completed text intervals immediately, while other relays or
          // less selective term indexes are still working on this batch.
          onProgress({
            loading: true,
            canLoadMore: false,
            oldestSearched: oldestSearched(),
          })
          leave(!timedOut)
        }
      }
      const record = (event: AppEvent, url: string | undefined, fromCache: boolean) => {
        if (!url || source.delegated.has(url)) return
        const filled = source.cursor.record(event, url, fromCache)
        // A relay that filled its page has nothing more to send for it. Page it
        // on its own now: the other relays may take seconds to answer or time out.
        if (filled && perRelay && source.relayUrls?.length !== 1 && delegate(source, url))
          leave(true)
      }
      source.sub = nostr.subscribe(source.cursor.current, {
        relayUrls: source.relayUrls,
        cacheUsage: CacheMode.ONLY_RELAY,
        groupable: false,
        isolated: true,
      })
      source.sub.on("event", (event, relay, _sub, fromCache) => {
        if (stopped || (settled && !source.retry)) return
        onEvent(event)
        record(event, relay?.url, fromCache)
      })
      source.sub.on("event:dup", (event, relay, _elapsed, _sub, fromCache) => {
        if (!stopped && (!settled || source.retry)) record(event, relay?.url, fromCache)
      })
      source.sub.on("eose", () => {
        if (stopped || settled) return
        // Incomplete history is retryable; it must not advance past unseen posts.
        const completion = source.sub?.completion
        if (perRelay && completion?.complete === false) {
          // A failed relay must retry its original interval. Relays that actually
          // supplied this filter and completed it can continue independently.
          const incomplete = new Set(
            completion.sources.filter((s) => !s.complete).map((s) => s.id)
          )
          for (const {id, complete} of completion.sources) {
            if (!complete || incomplete.has(id) || incomplete.has("local-cache")) continue
            delegate(source, id)
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
      pagesLeft = pageBudget
      run(false, !retryIncomplete)
    },
    stop() {
      stopped = true
      for (const source of sources) {
        clearTimeout(source.timer)
        source.sub?.stop()
        source.sub = undefined
        source.timer = undefined
        source.running = false
      }
    },
  }
}
