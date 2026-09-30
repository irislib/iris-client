import {useState, useMemo} from "react"
import {useNavigate} from "@/navigation"
import {GeohashMap} from "@/shared/components/geohash/GeohashMap"
import Feed from "@/shared/components/feed/Feed"
import {KIND_TEXT_NOTE, KIND_EPHEMERAL, DEBUG_NAMESPACES} from "@/utils/constants"
import {AppEvent} from "@/lib/nostr"
import {type FeedConfig} from "@/stores/feed"
import {createDebugLogger} from "@/utils/createDebugLogger"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

interface MapWithEventsProps {
  selectedGeohashes: string[]
  feedConfig?: FeedConfig // Optional, will create default if not provided
  height?: string
  className?: string
  displayAs?: "list" | "grid"
}

export default function MapWithEvents({
  selectedGeohashes,
  feedConfig: providedFeedConfig,
  height = "20rem",
  className = "w-full",
  displayAs = "list",
}: MapWithEventsProps) {
  const navigate = useNavigate()
  const [feedEvents, setFeedEvents] = useState<AppEvent[]>([])

  // Use provided feedConfig or create default
  const feedConfig = useMemo(() => {
    if (providedFeedConfig) {
      return providedFeedConfig
    }

    // Fallback for when no config is provided
    const isGlobalView = selectedGeohashes.length === 0
    const filter = isGlobalView
      ? {
          kinds: [KIND_TEXT_NOTE, KIND_EPHEMERAL],
          limit: 500,
        }
      : {
          kinds: [KIND_TEXT_NOTE, KIND_EPHEMERAL],
          "#g": selectedGeohashes,
          limit: 200,
        }

    return {
      id: `map-events-${selectedGeohashes.join(",") || "global"}`,
      name: "Map Events",
      filter,
      followDistance: 5,
      showRepliedTo: true,
      hideReplies: false,
      displayAs,
      // For map feeds in global view, require location tags
      requiresLocationTag: isGlobalView,
    }
  }, [selectedGeohashes, displayAs, providedFeedConfig])

  return (
    <div className={className} style={{height}}>
      <GeohashMap
        geohashes={selectedGeohashes}
        feedEvents={feedEvents}
        onGeohashSelect={(geohash) => {
          if (geohash === "*") {
            navigate("/map")
          } else {
            navigate(`/map/${geohash.toLowerCase()}`)
          }
        }}
        height="100%"
        className="w-full h-full"
      />

      {/* Hidden feed to collect events for the map */}
      <div className="hidden">
        <Feed
          key={selectedGeohashes.join(",") || "global"}
          feedConfig={feedConfig}
          onEvent={(event) => {
            setFeedEvents((prev) => {
              // Log events with location tags
              const locationTags = event.tags?.filter(
                (tag) => tag[0] === "location" && tag[1]
              )
              if (locationTags?.length > 0) {
                log("MapWithEvents received event with location:", locationTags[0][1])
              }
              if (prev.some((e) => e.id === event.id)) return prev
              return [...prev.slice(-199), event]
            })
          }}
        />
      </div>
    </div>
  )
}
