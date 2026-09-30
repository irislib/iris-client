import {AppEvent} from "@/lib/nostr"
import {RiMapPinLine} from "@remixicon/react"
import {Link} from "@/navigation"

interface GeohashLocationProps {
  event: AppEvent
  className?: string
}

export function GeohashLocation({event, className = ""}: GeohashLocationProps) {
  // Get location tags from the event
  const locationTags = event.tags.filter((tag) => tag[0] === "location" && tag[1])

  // Get geohash tags from the event and convert to lowercase
  const geohashTags = event.tags.filter((tag) => tag[0] === "g" && tag[1])

  if (locationTags.length === 0 && geohashTags.length === 0) {
    return null
  }

  // Get first location tag and truncate if needed
  const locationText = locationTags.length > 0 ? locationTags[0][1] : null
  const truncatedLocation =
    locationText && locationText.length > 30
      ? locationText.substring(0, 30) + "..."
      : locationText

  // Get all unique geohashes (lowercase) and sort by length (most specific first)
  const uniqueGeohashes = [
    ...new Set(geohashTags.map((tag) => tag[1].toLowerCase())),
  ].sort((a, b) => b.length - a.length)

  // Filter to only show the most specific geohashes for each location root
  const mostSpecificGeohashes: string[] = []
  for (const geohash of uniqueGeohashes) {
    // Check if this geohash is already represented by a more specific one
    const isRepresented = mostSpecificGeohashes.some((specific) =>
      specific.startsWith(geohash)
    )
    if (!isRepresented) {
      // Remove any less specific geohashes that this one represents
      const filtered = mostSpecificGeohashes.filter(
        (existing) => !geohash.startsWith(existing)
      )
      filtered.push(geohash)
      mostSpecificGeohashes.length = 0
      mostSpecificGeohashes.push(...filtered)
    }
  }

  // Sort alphabetically for consistent display
  mostSpecificGeohashes.sort()

  // Determine what to show based on the rules
  const hasSingleLocation = mostSpecificGeohashes.length === 1
  const hasNoGeohashes = mostSpecificGeohashes.length === 0

  // If only location text and no geohashes, show just the location
  if (hasNoGeohashes && locationText) {
    return (
      <div
        className={`flex items-center gap-1 text-xs text-base-content/50 flex-wrap ${className}`}
      >
        <RiMapPinLine className="w-3 h-3 flex-shrink-0" />
        <span title={locationText}>{truncatedLocation}</span>
      </div>
    )
  }

  // If single location and has location tag, show only location text but link to most specific geohash
  if (hasSingleLocation && locationText) {
    const mostSpecificGeohash = uniqueGeohashes[0] // Already sorted by length
    return (
      <div
        className={`flex items-center gap-1 text-xs text-base-content/50 flex-wrap ${className}`}
      >
        <RiMapPinLine className="w-3 h-3 flex-shrink-0" />
        <Link
          to={`/map/${mostSpecificGeohash}`}
          className="hover:text-base-content/70 hover:underline"
          onClick={(e) => e.stopPropagation()}
          title={locationText}
        >
          {truncatedLocation}
        </Link>
      </div>
    )
  }

  // Otherwise show geohashes (most specific ones only)
  return (
    <div
      className={`flex items-center gap-1 text-xs text-base-content/50 flex-wrap ${className}`}
    >
      <RiMapPinLine className="w-3 h-3 flex-shrink-0" />
      {mostSpecificGeohashes.map((geohash, index) => (
        <span key={geohash}>
          <Link
            to={`/map/${geohash}`}
            className="hover:text-base-content/70 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {geohash}
          </Link>
          {index < mostSpecificGeohashes.length - 1 && <span className="mx-1">·</span>}
        </span>
      ))}
    </div>
  )
}
