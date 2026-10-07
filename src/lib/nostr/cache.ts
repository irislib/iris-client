import {matchFilters, verifyEvent, type Event, type Filter} from "nostr-tools"
import type {QueryOptions, RuntimeEventStore} from "nostr-pubsub"
import {AppEvent, profileFromEvent, type UserProfile, type EventFilter} from "./index"
import {createDatabase, db, type Event as StoredEvent} from "./db"

/** App metadata and the pubsub store share one database; no parallel event cache. */
export class EventCache {
  readonly store: RuntimeEventStore
  constructor() {
    createDatabase("iris-pubsub")
    this.store = {
      query: (filters, options) => this.queryEvents(filters as Filter[], options),
      put: (event) => this.put(event),
      delete: async (ids) => {
        await db.events.bulkDelete(ids)
      },
      listPending: async () => db.unpublishedEvents.toArray(),
      putPending: async (entry) => {
        await db.unpublishedEvents.put({...entry, id: entry.event.id})
      },
      deletePending: async (id) => {
        await db.unpublishedEvents.delete(id)
      },
    }
  }
  private async put(event: Event) {
    const tagIndex = event.tags.filter((t) => t.length > 1).map((t) => `${t[0]}:${t[1]}`)
    await db.transaction("rw", [db.events, db.profiles], async () => {
      await db.events.put({
        id: event.id,
        pubkey: event.pubkey,
        kind: event.kind,
        createdAt: event.created_at,
        event: JSON.stringify(event),
        sig: event.sig,
        tagIndex,
      })
      if (event.kind === 0) {
        const current = await db.profiles.get(event.pubkey)
        if (!current || Number(current.created_at ?? 0) <= event.created_at)
          await db.profiles.put({
            ...profileFromEvent(event),
            profileEvent: JSON.stringify(event),
            pubkey: event.pubkey,
            created_at: event.created_at,
            cachedAt: Date.now(),
          })
      }
    })
  }
  private async queryEvents(filters: Filter[], options?: QueryOptions) {
    const events = new Map<string, Event>()
    for (const filter of filters) {
      if (options?.signal?.aborted) throw options.signal.reason
      const tag = Object.entries(filter).find(
        ([key, value]) => key.startsWith("#") && Array.isArray(value) && value.length
      )
      const cap = filter.limit ?? options?.limit ?? 5000
      const authors = filter.authors && new Set(filter.authors)
      const kinds = filter.kinds && new Set(filter.kinds)
      const matches = (record: StoredEvent) => {
        options?.signal?.throwIfAborted()
        // Filter indexed metadata before decoding retained event bodies.
        if (authors && !authors.has(record.pubkey)) return false
        if (kinds && !kinds.has(record.kind)) return false
        if (filter.since !== undefined && record.createdAt < filter.since) return false
        if (filter.until !== undefined && record.createdAt > filter.until) return false
        const event = JSON.parse(record.event) as Event
        return (
          matchFilters([filter], event) &&
          (!filter.search ||
            filter.search
              .toLowerCase()
              .split(/\s+/)
              .every((word) => event.content.toLowerCase().includes(word)))
        )
      }
      let records: StoredEvent[]
      if (filter.ids?.every((id) => id.length === 64)) {
        records = await db.events.where("id").anyOf(filter.ids).filter(matches).toArray()
      } else if (tag) {
        records = await db.events
          .where("tagIndex")
          .anyOf((tag[1] as string[]).map((value) => `${tag[0].slice(1)}:${value}`))
          .filter(matches)
          .toArray()
      } else if (
        filter.authors?.every((author) => author.length === 64) &&
        filter.since === undefined &&
        filter.until === undefined
      ) {
        // Profile/follow-list lookups are selective by author, not time. Scanning
        // every cached profile would starve the feed reads sharing this database.
        const collection = filter.kinds?.length
          ? db.events
              .where("[pubkey+kind]")
              .anyOf(
                filter.authors.flatMap((author) =>
                  filter.kinds!.map((kind) => [author, kind])
                )
              )
          : db.events.where("pubkey").anyOf(filter.authors)
        records = await collection.filter(matches).toArray()
      } else {
        const lower = filter.since ?? 0
        const upper = filter.until ?? Number.MAX_SAFE_INTEGER
        if (lower > upper || cap <= 0) continue
        // Each ordered index stops at the requested limit. In particular, a
        // feed following hundreds of authors must not load their entire history.
        let ranges = [db.events.where("createdAt").between(lower, upper, true, true)]
        if (filter.authors?.length === 1) {
          ranges = [
            db.events
              .where("[pubkey+createdAt]")
              .between(
                [filter.authors[0], lower],
                [filter.authors[0], upper],
                true,
                true
              ),
          ]
        } else if (filter.kinds?.length) {
          ranges = [...new Set(filter.kinds)].map((kind) =>
            db.events
              .where("[kind+createdAt]")
              .between([kind, lower], [kind, upper], true, true)
          )
        }
        records = (
          await Promise.all(
            ranges.map((range) => range.reverse().filter(matches).limit(cap).toArray())
          )
        ).flat()
      }
      options?.signal?.throwIfAborted()
      const matching = records
        .map((record) => JSON.parse(record.event) as Event)
        .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
      for (const event of matching.slice(0, filter.limit ?? options?.limit ?? 5000))
        events.set(event.id, event)
    }
    return [...events.values()]
      .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
      .slice(0, options?.limit ?? 5000)
  }
  async fetchProfile(pubkey: string): Promise<UserProfile | null> {
    return (await db.profiles.get(pubkey)) ?? null
  }
  async setEvent(event: AppEvent | Event, _filters?: EventFilter[], _relay?: unknown) {
    const raw = event instanceof AppEvent ? event.rawEvent() : event
    if (!verifyEvent(raw)) throw new Error("Invalid event signature")
    await this.put(raw)
  }
}
export {db} from "./db"
export default EventCache
