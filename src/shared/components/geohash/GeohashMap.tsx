import {lazy, Suspense} from "react"
import type {AppEvent} from "@/lib/nostr"
import "leaflet/dist/leaflet.css"

interface GeohashMapProps {
  geohashes?: string[]
  feedEvents?: AppEvent[]
  onGeohashSelect?: (geohash: string) => void
  height?: string
  className?: string
}

const MapContent = lazy(() => import("./GeohashMapContent"))

export function GeohashMap({
  geohashes = [],
  feedEvents = [],
  onGeohashSelect,
  height = "24rem",
  className = "",
}: GeohashMapProps) {
  return (
    <div className={`relative w-full ${className}`} style={{height}}>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full bg-base-200 w-full">
            <span className="loading loading-spinner loading-md"></span>
          </div>
        }
      >
        <MapContent
          geohashes={geohashes}
          feedEvents={feedEvents}
          onGeohashSelect={onGeohashSelect}
          height={height}
        />
      </Suspense>
    </div>
  )
}
