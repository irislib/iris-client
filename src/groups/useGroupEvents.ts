import {useCallback, useSyncExternalStore} from "react"
import {matchFilters, type Event} from "nostr-tools"
import {NDKSubscriptionCacheUsage, type NDKFilter, type NDKSubscription} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"
import {GroupEventBuffer} from "./GroupEventBuffer"
import {isVisibleGroupZap} from "./activity"
import type {GroupRef} from "./model"

export type GroupEventSnapshot = {
  events: Event[]
  loading: boolean
  limited: boolean
  error?: string
}
export interface GroupEventOptions {
  liveFilters?: NDKFilter[]
  perAuthorCap?: number
  factTargets?: string[]
  refreshKey?: string | number
  zap?: {ref: GroupRef; targetId: string; authors: string[]}
}
const EMPTY: GroupEventSnapshot = {events: [], loading: false, limited: false}
const LOADING: GroupEventSnapshot = {events: [], loading: true, limited: false}
const HISTORY_BATCH = 16
const HISTORY_CONCURRENCY = 2
const HISTORY_TIMEOUT = 12_000
const PARTIAL_ERROR = "Some relay results are unavailable. Refresh to try again."
type Subscribe = (filters: NDKFilter[], closeOnEose: boolean) => NDKSubscription
const defaultSubscribe: Subscribe = (filters, closeOnEose) =>
  ndk().subscribe(
    filters,
    // Keep the explicit batch bound on the wire too; NDK otherwise combines
    // concurrent collections into a larger relay request.
    {closeOnEose, groupable: false, cacheUsage: NDKSubscriptionCacheUsage.PARALLEL},
    false
  )

// An empty array is an impossible constraint, never permission for a broad query.
const possibleFilters = (filters: NDKFilter[]) =>
  filters.filter(
    (filter) =>
      !Object.entries(filter).some(
        ([key, value]) =>
          (key === "authors" ||
            key === "ids" ||
            key === "kinds" ||
            key.startsWith("#")) &&
          Array.isArray(value) &&
          value.length === 0
      )
  )

/** Use one live REQ. Precise original filters still guard every received event. */
export function consolidateGroupLiveFilters(
  filters: NDKFilter[],
  since: number
): NDKFilter[] {
  const groups = new Map<string, NDKFilter>()
  for (const filter of possibleFilters(filters)) {
    const {authors, limit: _limit, ...rest} = filter
    const normalized = {...rest, since: Math.max(since, filter.since ?? since)}
    const key = JSON.stringify(
      Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b))
    )
    const current = groups.get(key)
    if (!current)
      groups.set(key, {...normalized, ...(authors ? {authors: [...authors]} : {})})
    else if (!authors || !current.authors) delete current.authors
    else current.authors = [...new Set([...current.authors, ...authors])]
  }
  const result = [...groups.values()]
  if (result.length <= HISTORY_BATCH) return result
  // Author-specific subject filters can number in the thousands. Their union is
  // a safe live superset; local matching below rejects cross-product matches.
  const broad: Record<string, unknown> = {since}
  for (const [key, value] of Object.entries(result[0])) {
    if (key === "since" || key === "until") continue
    if (!result.every((filter) => key in filter)) continue
    const values = result.map((filter) => (filter as Record<string, unknown>)[key])
    if (Array.isArray(value) && values.every(Array.isArray))
      broad[key] = [...new Set(values.flat())]
    else if (values.every((item) => item === value)) broad[key] = value
  }
  return [broad as NDKFilter]
}

/** Shared bounded history with a live stream started before the first history read. */
export class GroupEventCollection {
  private listeners = new Set<() => void>()
  private subscriptions = new Set<NDKSubscription>()
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private batchTimer?: ReturnType<typeof setTimeout>
  private generation = 0
  private started = false
  private buffer: GroupEventBuffer
  private filters: NDKFilter[]
  private liveAdmission: NDKFilter[]
  private snapshot: GroupEventSnapshot = LOADING

  constructor(
    filters: NDKFilter[],
    cap: number,
    options: GroupEventOptions = {},
    private source: Subscribe = defaultSubscribe
  ) {
    this.filters = possibleFilters(filters)
    this.liveAdmission = possibleFilters(options.liveFilters ?? filters)
    const zapAuthors = new Set(options.zap?.authors)
    this.buffer = new GroupEventBuffer({
      capacity: cap,
      perAuthorCap: options.perAuthorCap,
      factTargets: options.factTargets,
      admission: options.zap
        ? (event) => {
            if (event.kind !== 9735) return null
            const senders = event.tags.filter((tag) => tag[0] === "P")
            if (senders.length !== 1 || senders[0].length !== 2) return null
            const author = senders[0][1]
            if (
              !isVisibleGroupZap({pubkey: author, event}, options.zap!.targetId, {
                ref: options.zap!.ref,
                isEligible: (pubkey) => zapAuthors.has(pubkey),
              })
            )
              return null
            const request = JSON.parse(
              event.tags.find((tag) => tag[0] === "description")![1]
            ) as Event
            return {author, key: `zap:${request.id}`}
          }
        : undefined,
    })
  }

  get subscriberCount() {
    return this.listeners.size
  }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    if (!this.started) this.start()
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.listeners.delete(listener)
      if (!this.listeners.size) this.stop()
    }
  }

  private flush = () => {
    clearTimeout(this.batchTimer)
    this.batchTimer = undefined
    this.snapshot = {
      ...this.snapshot,
      events: this.buffer.getEvents(),
      limited: this.buffer.limited,
    }
    this.listeners.forEach((listener) => listener())
  }

  private receive(event: Event, filters: NDKFilter[], epoch: number) {
    if (!this.started || epoch !== this.generation) return
    try {
      if (!matchFilters(filters, event)) return
      const wasLimited = this.buffer.limited
      const changed = this.buffer.add(event)
      if ((changed || wasLimited !== this.buffer.limited) && !this.batchTimer) {
        this.batchTimer = setTimeout(this.flush, 50)
      }
    } catch {
      /* Malformed relay data cannot interrupt other results. */
    }
  }

  private close(sub: NDKSubscription) {
    this.subscriptions.delete(sub)
    try {
      sub.stop()
    } catch {
      /* A failed transport still releases its slot. */
    }
  }

  private start() {
    this.started = true
    const epoch = ++this.generation
    const liveFilters = consolidateGroupLiveFilters(
      this.liveAdmission,
      Math.floor(Date.now() / 1000)
    )
    if (liveFilters.length) {
      let live: NDKSubscription | undefined
      try {
        live = this.source(liveFilters, false)
        this.subscriptions.add(live)
        live.on("event", (event) =>
          this.receive(event.rawEvent() as Event, this.liveAdmission, epoch)
        )
        live.start()
      } catch {
        if (live) this.close(live)
        this.snapshot = {...this.snapshot, error: PARTIAL_ERROR}
      }
    }
    const batches: NDKFilter[][] = []
    for (let i = 0; i < this.filters.length; i += HISTORY_BATCH)
      batches.push(this.filters.slice(i, i + HISTORY_BATCH))
    let next = 0
    let running = 0
    let pumping = false
    const pump = () => {
      if (pumping || !this.started || epoch !== this.generation) return
      pumping = true
      while (
        running < HISTORY_CONCURRENCY &&
        next < batches.length &&
        this.started &&
        epoch === this.generation
      ) {
        const batch = batches[next++]
        running++
        let sub: NDKSubscription | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        let finished = false
        const finish = (failed = false) => {
          if (finished || !this.started || epoch !== this.generation) return
          finished = true
          if (timer) {
            clearTimeout(timer)
            this.timers.delete(timer)
          }
          if (sub) this.close(sub)
          running--
          if (failed) this.snapshot = {...this.snapshot, error: PARTIAL_ERROR}
          if (running === 0 && next === batches.length)
            this.snapshot = {...this.snapshot, loading: false}
          this.flush()
          pump()
        }
        try {
          sub = this.source(batch, true)
          this.subscriptions.add(sub)
          sub.on("event", (event) => {
            if (!finished) this.receive(event.rawEvent() as Event, batch, epoch)
          })
          sub.on("eose", () => finish())
          timer = setTimeout(() => finish(true), HISTORY_TIMEOUT)
          this.timers.add(timer)
          sub.start()
        } catch {
          finish(true)
        }
      }
      pumping = false
    }
    if (!batches.length) {
      this.snapshot = {...this.snapshot, loading: false}
      this.flush()
    } else pump()
  }

  private stop() {
    this.started = false
    this.generation++
    for (const sub of [...this.subscriptions]) this.close(sub)
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    clearTimeout(this.batchTimer)
    this.batchTimer = undefined
    this.buffer.clear()
    this.snapshot = LOADING
  }
}

const collections = new Map<string, GroupEventCollection>()
const emptySubscribe = () => () => {}
const emptySnapshot = () => EMPTY

export function useGroupEvents(
  filters: NDKFilter[],
  cap = 2000,
  options: GroupEventOptions = {}
) {
  const key =
    filters.length || options.liveFilters?.length
      ? JSON.stringify([filters, cap, options])
      : ""
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!key) return emptySubscribe()
      let collection = collections.get(key)
      if (!collection) {
        collection = new GroupEventCollection(filters, cap, options)
        collections.set(key, collection)
      }
      const unsubscribe = collection.subscribe(listener)
      return () => {
        unsubscribe()
        if (collections.size > 100) {
          for (const [entryKey, entry] of collections) {
            // Active proof reads often have no events yet; never evict their owner.
            if (!entry.subscriberCount) collections.delete(entryKey)
            if (collections.size <= 100) break
          }
        }
      }
    },
    [key]
  )
  const getSnapshot = useCallback(
    () => (key ? (collections.get(key)?.getSnapshot() ?? LOADING) : EMPTY),
    [key]
  )
  return useSyncExternalStore(subscribe, getSnapshot, emptySnapshot)
}
