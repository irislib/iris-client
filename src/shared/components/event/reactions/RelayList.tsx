import {useState, MouseEvent} from "react"
import {Link} from "react-router"
import type {NDKRelay} from "@nostr-dev-kit/ndk"

export default function RelayList({relays}: {relays: NDKRelay[]}) {
  const [showAll, setShowAll] = useState(false)
  const maxToShow = 5

  // Normalize relay URLs for deduplication and display
  const normalizeUrl = (url: string) => {
    let u = url.replace(/^wss:\/\//, "")
    if (u.endsWith("/")) u = u.slice(0, -1)
    return u
  }

  // Deduplicate relays by normalized URL
  const dedupedRelays = Array.from(
    new Map(relays.map((r) => [normalizeUrl(r.url), r])).values()
  )

  const relaysToShow = showAll ? dedupedRelays : dedupedRelays.slice(0, maxToShow)

  if (relaysToShow.length === 0) return null

  return (
    <div className="px-4 pb-2 pt-1 text-xs text-base-content/50 flex flex-col gap-1 items-start">
      {relaysToShow.map((relay, i) => (
        <Link
          key={relay.url + i}
          to={`/relay/${normalizeUrl(relay.url)}`}
          className="truncate max-w-full text-primary hover:underline"
          onClick={(e: MouseEvent) => e.stopPropagation()}
        >
          {normalizeUrl(relay.url)}
        </Link>
      ))}
      {dedupedRelays.length > maxToShow && (
        <button
          className="text-primary hover:underline mt-1 text-xs"
          onClick={(e) => {
            e.stopPropagation()
            setShowAll((v) => !v)
          }}
        >
          {showAll ? "Show less" : `Show ${dedupedRelays.length - maxToShow} more`}
        </button>
      )}
    </div>
  )
}
