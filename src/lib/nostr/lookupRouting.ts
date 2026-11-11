import type {EventFilter, EventSubscription, NostrClient} from "./index"
import {normalizedRelayUrls, relayHints, relayHintsFromUrls} from "./relayPolicy"

/** Head start for a caller's own request before its authors' relay lists are looked up. */
export const AUTHOR_ROUTE_DELAY_MS = 100

/** How long saved relays get to answer an id lookup before the fallbacks are asked. */
export const ID_FALLBACK_DELAY_MS = 1000

/** Keep discovery on the shared transport, and release every route with its caller. */
export function attachLookupRoutes(client: NostrClient, parent: EventSubscription) {
  if (
    parent.opts.privateRelayScope ||
    parent.opts.relayUrls ||
    parent.opts.cacheUsage === "cache-only"
  )
    return

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

  // A bare event id names neither author nor relay, so nothing above can route it.
  // One unreachable saved relay must not be the only path to the post.
  const missing = new Set(parent.filters.flatMap((f) => f.ids ?? []))
  if (missing.size && client.fallbackRelayUrls.length) {
    parent.on("event", (event) => missing.delete(event.id))
    const timer = setTimeout(() => {
      if (missing.size) attach([{ids: [...missing]}], client.fallbackRelayUrls)
    }, ID_FALLBACK_DELAY_MS)
    parent.once("close", () => clearTimeout(timer))
  }

  const authors = [...new Set(parent.filters.flatMap((f) => f.authors ?? []))]
    .filter((key) => /^[0-9a-f]{64}$/.test(key))
    .slice(0, 64)
  if (!authors.length) return
  // Act on each relay-list event as it arrives; an unavailable unrelated relay
  // must not delay author routing or turn a later relay list into a permanent miss.
  // Every author lookup opens its own relay connections, and browsers queue and
  // throttle bursts of new sockets. Let the caller's own request reach its relays
  // first; its history still waits for these routes.
  let finish: (() => void) | undefined
  const pending = {
    completion: undefined as EventSubscription["completion"],
    once: (_event: "eose", done: () => void) => {
      finish = done
    },
  }
  parent.waitForHistory(pending as unknown as EventSubscription)
  const routeTimer = setTimeout(() => {
    const lists = client.subscribe({kinds: [10002], authors})
    lists.once("eose", () => {
      pending.completion = lists.completion
      finish?.()
    })
    lists.on("event", (event) => attach(parent.filters, relayHints([event], "write")))
    parent.once("close", () => lists.stop())
  }, AUTHOR_ROUTE_DELAY_MS)
  parent.once("close", () => clearTimeout(routeTimer))
}
