import type {EventFilter, EventSubscription, NostrClient} from "./index"
import {normalizedRelayUrls, relayHints, relayHintsFromUrls} from "./relayPolicy"

/** Keep discovery on the shared transport, and release every route with its caller. */
export function attachLookupRoutes(client: NostrClient, parent: EventSubscription) {
  if (parent.opts.relayUrls || parent.opts.cacheUsage === "cache-only") return

  const routes = new Set<string>()
  const configured = new Set(normalizedRelayUrls(client.explicitRelayUrls, Infinity))
  const attach = (filters: EventFilter[], urls: string[]) => {
    const selected = urls.filter((url) => {
      if (configured.has(url) || routes.has(url) || routes.size >= 8) return false
      routes.add(url)
      return true
    })
    if (!selected.length || parent.closed) return
    const child = client.subscribe(filters, {
      relayUrls: selected,
      closeOnEose: false,
      cacheUsage: "network-only",
    })
    parent.waitForHistory(child)
    child.on("event", (event, relay, _sub, cached) =>
      parent.eventReceived(event, relay, cached)
    )
    parent.once("close", () => child.stop())
  }

  // Directory relays carry metadata, not general feeds or private messages.
  const metadata = parent.filters.filter(
    (f) =>
      f.authors?.length && f.kinds?.length && f.kinds.every((k) => k === 0 || k === 10002)
  )
  if (metadata.length) attach(metadata, client.discoveryRelayUrls)
  if (client.enableRelayHints) {
    attach(parent.filters, relayHintsFromUrls(parent.opts.relayHints ?? []))
  }

  if (!client.enableOutboxModel || parent.filters.some((f) => f.kinds?.includes(10002)))
    return
  const authors = [...new Set(parent.filters.flatMap((f) => f.authors ?? []))]
    .filter((key) => /^[0-9a-f]{64}$/.test(key))
    .slice(0, 64)
  if (!authors.length) return
  // Act on each relay-list event as it arrives; an unavailable unrelated relay
  // must not delay author routing or turn a later relay list into a permanent miss.
  const lists = client.subscribe({kinds: [10002], authors})
  parent.waitForHistory(lists)
  lists.on("event", (event) => attach(parent.filters, relayHints([event], "write")))
  parent.once("close", () => lists.stop())
}
