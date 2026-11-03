import {getMainThreadDb} from "@/lib/nostr/db"
import {marketStore} from "@/stores/marketstore"

let previous: {at: number; tags: Promise<string[]>} | undefined
// Reuse the existing public note cache and Market's seen-tag catalogue. Reading
// one bounded page avoids a database-wide scan or a new relay subscription.
export function knownSearchTags() {
  if (previous && Date.now() - previous.at < 60000) return previous.tags
  const recent = getMainThreadDb()
    .events.where("[kind+createdAt]")
    .between([1, 0], [1, Math.floor(Date.now() / 1000)], true, true)
    .reverse()
    .limit(96)
    .toArray()
    .then((rows) =>
      rows.flatMap(({tagIndex}) =>
        tagIndex?.some((t) => t.startsWith("h:"))
          ? []
          : (tagIndex ?? [])
              .filter((t) => t.startsWith("t:"))
              .slice(0, 8)
              .map((t) => t.slice(2))
      )
    )
    .catch(() => [])
  const tags = Promise.all([recent, marketStore.getTags().catch(() => [])]).then(
    ([notes, market]) => [
      ...new Set([...new Set(notes)].slice(0, 96).concat(market.slice(0, 64))),
    ]
  )
  previous = {at: Date.now(), tags}
  return tags
}
