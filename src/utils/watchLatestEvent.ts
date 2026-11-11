import type {AppEvent, EventFilter, SubscriptionOptions} from "@/lib/nostr"
import {nostr} from "@/utils/nostrClient"

export interface StoredHistory {
  found: boolean
  /** Every source finished reading; false when any stayed silent or failed. */
  complete: boolean
}

/**
 * Deliver the newest event for a replaceable or addressable filter as soon as any
 * source has it, then every newer version. Nothing here waits for relays: `onHistory`
 * only tells "none exists" from "nobody answered" for callers that need the difference.
 */
export function watchLatestEvent(
  filter: EventFilter,
  onEvent: (event: AppEvent) => void,
  opts: SubscriptionOptions = {},
  onHistory?: (history: StoredHistory) => void
) {
  let latest: AppEvent | undefined
  const sub = nostr().subscribe(filter, {...opts, closeOnEose: false})
  sub.on("event", (event: AppEvent) => {
    if (latest && latest.created_at >= event.created_at) return
    latest = event
    onEvent(event)
  })
  sub.on("eose", () =>
    onHistory?.({
      found: !!latest,
      complete: !!sub.completion?.complete && sub.completion.reason === "eose",
    })
  )
  return () => sub.stop()
}
