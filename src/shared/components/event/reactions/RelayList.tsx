import {useState, MouseEvent} from "react"
import {Link} from "react-router"
// NDKRelay type no longer needed - using direct relay URLs

export default function RelayList({relays}: {relays: string[]}) {
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
    new Map(relays.map((r) => [normalizeUrl(r), r])).values()
  )

  const relaysToShow = showAll ? dedupedRelays : dedupedRelays.slice(0, maxToShow)

  if (relaysToShow.length === 0) return null

  return (
    <div className="px-4 pb-2 pt-1 text-xs text-base-content/50 flex flex-col gap-1 items-start">
      {relaysToShow.map((relay, i) => (
        <Link
          key={relay + i}
          to={`/relay/${normalizeUrl(relay)}`}
          className="truncate max-w-full text-primary hover:underline"
          onClick={(e: MouseEvent) => e.stopPropagation()}
        >
          {normalizeUrl(relay)}
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
