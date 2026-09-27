import type {NDKFilter} from "@/lib/ndk"

/** One cursor per query, based on raw relay deliveries, before client filtering. */
export class SearchPageCursor {
  private relays = new Map<string, Map<string, number>>()
  private filter: NDKFilter

  constructor(filter: NDKFilter) {
    this.filter = {...filter, until: filter.until ?? Math.floor(Date.now() / 1000)}
  }

  get current(): NDKFilter {
    return this.filter
  }

  record(event: {id?: string; created_at?: number}, relay?: string, fromCache = false) {
    if (
      fromCache ||
      !event.id ||
      !relay ||
      !event.created_at ||
      event.created_at > this.filter.until!
    )
      return
    if (!this.relays.has(relay)) this.relays.set(relay, new Map())
    this.relays.get(relay)!.set(event.id, event.created_at)
  }

  next(): NDKFilter | null {
    const boundaries = [...this.relays.values()].map((events) =>
      Math.min(...events.values())
    )
    if (!boundaries.length) return null
    // A sparse old source must not move a denser source past unseen history.
    const until = Math.max(...boundaries)
    if (until < this.filter.until!) return {...this.filter, until}
    const limit = this.filter.limit ?? 100
    const saturated = [...this.relays.values()].some((events) => events.size >= limit)
    if (saturated) {
      // Include the boundary second again, with room for ties. Never silently
      // discard the rest of a saturated timestamp to force pagination forward.
      return limit < 1600 ? {...this.filter, limit: limit * 2} : null
    }
    return until > 0 ? {...this.filter, until: until - 1} : null
  }

  advance() {
    const next = this.next()
    if (!next) return false
    this.filter = next
    this.relays.clear()
    return true
  }
}
