import {matchFilters, verifyEvent, type Event, type Filter} from "nostr-tools"
import type {QueryOptions, RuntimeEventStore} from "nostr-pubsub"
import {AppEvent, profileFromEvent, type UserProfile, type EventFilter} from "./index"
import {createDatabase, db} from "./db"

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
      const timeOrdered =
        !filter.ids &&
        !tag &&
        (filter.authors?.length === 1 ||
          (!filter.authors && filter.kinds?.length === 1) ||
          (!filter.authors && !tag && !filter.kinds))
      let collection = db.events.orderBy("createdAt").reverse()
      if (filter.ids?.every((id) => id.length === 64)) {
        collection = db.events.where("id").anyOf(filter.ids)
      } else if (tag) {
        collection = db.events
          .where("tagIndex")
          .anyOf((tag[1] as string[]).map((value) => `${tag[0].slice(1)}:${value}`))
      } else if (filter.authors?.length === 1) {
        collection = db.events
          .where("[pubkey+createdAt]")
          .between(
            [filter.authors[0], filter.since ?? 0],
            [filter.authors[0], filter.until ?? Number.MAX_SAFE_INTEGER],
            true,
            true
          )
          .reverse()
      } else if (filter.authors?.every((author) => author.length === 64)) {
        collection = db.events.where("pubkey").anyOf(filter.authors)
      } else if (filter.kinds?.length === 1) {
        collection = db.events
          .where("[kind+createdAt]")
          .between(
            [filter.kinds[0], filter.since ?? 0],
            [filter.kinds[0], filter.until ?? Number.MAX_SAFE_INTEGER],
            true,
            true
          )
          .reverse()
      } else if (filter.kinds?.length) {
        collection = db.events.where("kind").anyOf(filter.kinds)
      }
      const matches = (event: Event) =>
        matchFilters([filter], event) &&
        (!filter.search ||
          filter.search
            .toLowerCase()
            .split(/\s+/)
            .every((word) => event.content.toLowerCase().includes(word)))
      // Feed queries scan the time index backwards and stop at their requested
      // limit instead of parsing every retained note on each scroll or refresh.
      const selected = timeOrdered
        ? collection.filter((record) => matches(JSON.parse(record.event))).limit(cap)
        : collection
      const records = await selected.toArray()
      const matching = records
        .map((record) => JSON.parse(record.event) as Event)
        .filter(matches)
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
