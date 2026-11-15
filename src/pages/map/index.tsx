import {useNavigate, useParams} from "@/navigation"
import {useMemo, useState} from "react"
import Feed from "@/shared/components/feed/Feed"
import {KIND_TEXT_NOTE, KIND_EPHEMERAL} from "@/utils/constants"
import {GeohashMap} from "@/shared/components/geohash/GeohashMap"
import Header from "@/shared/components/header/Header"
import {ScrollablePageContainer} from "@/shared/components/layout/ScrollablePageContainer"
import SearchTabSelector from "@/shared/components/search/SearchTabSelector"
import {Helmet} from "react-helmet"
import {useUIStore} from "@/stores/ui"
import type {AppEvent} from "@/lib/nostr"

export default function MapPage() {
  const {query} = useParams()
  const navigate = useNavigate()
  const geohashes = useMemo(() => (query ? [query.toLowerCase()] : []), [query])
  const [mapEvents, setMapEvents] = useState<AppEvent[]>([])
  const displayAs = useUIStore((state) => state.mapDisplayAs)
  const setMapDisplayAs = useUIStore((state) => state.setMapDisplayAs)
  const title = query ? `Map: ${query}` : "Map"
  const feedConfig = useMemo(
    () => ({
      id: `map-search-${geohashes.join(",") || "global"}`,
      name: "Location Feed",
      filter: {
        kinds: [KIND_TEXT_NOTE, KIND_EPHEMERAL],
        ...(geohashes.length ? {"#g": geohashes, limit: 200} : {limit: 500}),
      },
      followDistance: 5,
      showRepliedTo: true,
      hideReplies: false,
      displayAs,
      // Relays cannot query for the presence of location tags without a geohash.
      requiresLocationTag: !geohashes.length,
    }),
    [geohashes, displayAs]
  )

  return (
    <div className="flex flex-col flex-1 h-full relative">
      <Header title={title} />
      <ScrollablePageContainer className="flex flex-col items-center">
        <div className="flex-1 w-full flex flex-col gap-2 md:pt-2">
          <SearchTabSelector activeTab="map" />
          <div className="mt-4">
            <GeohashMap
              geohashes={geohashes}
              feedEvents={mapEvents}
              onGeohashSelect={(hash) =>
                navigate(hash === "*" ? "/map" : `/map/${hash.toLowerCase()}`)
              }
              height="20rem"
            />
            <div className="mt-4">
              <Feed
                key={feedConfig.id}
                feedConfig={feedConfig}
                onEvent={(event) =>
                  setMapEvents((events) => [...events.slice(-199), event])
                }
                showReplies={0}
                borderTopFirst
                showDisplayAsSelector
                displayAs={displayAs}
                onDisplayAsChange={setMapDisplayAs}
              />
            </div>
          </div>
        </div>
        <Helmet>
          <title>{title} / Iris</title>
        </Helmet>
      </ScrollablePageContainer>
    </div>
  )
}
