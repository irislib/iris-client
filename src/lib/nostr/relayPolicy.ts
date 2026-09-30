import type {Event} from "nostr-tools"

/** NIP-65 relay hints are bounded and never override an explicitly scoped operation. */
export function relayHints(
  events: Iterable<Event>,
  role: "read" | "write",
  limit = 6
): string[] {
  const newest = new Map<string, Event>()
  for (const event of events) {
    if (event.kind !== 10002) continue
    const previous = newest.get(event.pubkey)
    if (!previous || event.created_at > previous.created_at)
      newest.set(event.pubkey, event)
  }
  const urls = new Set<string>()
  for (const event of newest.values())
    for (const [name, url, marker] of event.tags) {
      if (name !== "r" || !url || (marker && marker !== role)) continue
      try {
        const parsed = new URL(url)
        if (
          !["wss:", "ws:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password
        )
          continue
        urls.add(parsed.toString().replace(/\/$/, ""))
        if (urls.size >= limit) return [...urls]
      } catch {
        /* Ignore malformed, untrusted relay metadata. */
      }
    }
  return [...urls]
}
