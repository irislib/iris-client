import {
  HistoryCursor,
  SOURCE_PRIORITY_RELAY,
  relaySource,
  type HistoryPage,
  type NostrEvent,
  type NostrVerifiedEvent,
} from "nostr-pubsub"
import type {EventFilter} from "@/lib/nostr"

type RelayPage = {cursor: HistoryCursor; page: HistoryPage}

/** One app query, with the shared raw-history cursor for each actual relay.
 * Client visibility and cross-relay deduplication must happen after record(). */
export class SearchPageCursor {
  private relays = new Map<string, RelayPage>()
  private filter: EventFilter
  private planned: EventFilter | null | undefined

  constructor(filter: EventFilter) {
    this.filter = {...filter, until: filter.until ?? Math.floor(Date.now() / 1000)}
  }

  get current(): EventFilter {
    return this.filter
  }

  record(event: NostrEvent, relay?: string, fromCache = false) {
    if (fromCache || !relay || this.planned !== undefined) return
    const source = relaySource(relay)
    let entry = this.relays.get(relay)
    const created = !entry
    if (!entry) {
      const cursor = new HistoryCursor(
        source.id,
        this.filter,
        this.filter.until!,
        Math.max(1600, this.filter.limit ?? 100)
      )
      entry = {cursor, page: cursor.beginPage()!}
      this.relays.set(relay, entry)
    }
    // The subscription/cache boundary already verified these wire events.
    // HistoryCursor owns filter/source checks, duplicate accounting and ties.
    const accepted = entry.cursor.observe(entry.page.token, {
      event: event as NostrVerifiedEvent,
      source,
      priority: SOURCE_PRIORITY_RELAY,
    })
    if (created && !accepted) this.relays.delete(relay)
  }

  /** Called only after complete EOSE; interrupted pages are retried unchanged. */
  next(): EventFilter | null {
    if (this.planned !== undefined) return this.planned
    const next: EventFilter[] = []
    for (const {cursor, page} of this.relays.values()) {
      const result = cursor.finishPage(page.token, "complete")
      // A saturated timestamp must remain explicitly limited rather than
      // advancing another relay past unseen tied events.
      if (result.status === "limited") return (this.planned = null)
      const request = cursor.beginPage()
      if (request) next.push(request.filter)
    }
    if (!next.length) return (this.planned = null)
    // A sparse old source must not move a denser source past unseen history.
    const until = Math.max(...next.map((filter) => filter.until!))
    const limit = Math.max(
      ...next.filter((filter) => filter.until === until).map((filter) => filter.limit!)
    )
    return (this.planned = {...this.filter, until, limit})
  }

  advance() {
    const next = this.next()
    if (!next) return false
    for (const {cursor} of this.relays.values()) cursor.cancel()
    this.filter = next
    this.relays.clear()
    this.planned = undefined
    return true
  }
}
