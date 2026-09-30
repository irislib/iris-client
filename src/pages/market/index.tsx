import {useParams} from "@/navigation"
import {useState, useCallback} from "react"
import Feed from "@/shared/components/feed/Feed"
import {useUIStore} from "@/stores/ui"
import Header from "@/shared/components/header/Header"
import {ScrollablePageContainer} from "@/shared/components/layout/ScrollablePageContainer"
import {Helmet} from "react-helmet"
import {useIsTwoColumnLayout} from "@/shared/hooks/useIsTwoColumnLayout"
import {AppEvent} from "@/lib/nostr"
import MarketFilters from "./components/MarketFilters"
import {marketStore} from "@/stores/marketstore"
import {buildMarketFeedConfig} from "./utils"

export default function MarketPage() {
  const {category} = useParams()
  const isInTwoColumnLayout = useIsTwoColumnLayout()
  const displayAs = useUIStore((state) => state.marketDisplayAs)
  const setMarketDisplayAs = useUIStore((state) => state.setMarketDisplayAs)
  const [mapEvents, setMapEvents] = useState<AppEvent[]>([])

  // Parse URL params directly without state to avoid stale values
  const params = new URLSearchParams(window.location.search)
  const selectedGeohash = params.get("g") || undefined
  const searchQuery = params.get("q") || undefined
  const additionalTags = params.get("t")?.split(",").filter(Boolean) || []
  const [lastFilterKey, setLastFilterKey] = useState<string | null>(null)

  // Callback to collect events for the map and track categories
  const handleMarketEvent = useCallback(
    async (event: AppEvent) => {
      // Create a filter key to track when filters change
      const currentFilterKey = `${category}-${selectedGeohash}-${searchQuery}-${additionalTags.join(",")}`

      // Check if event matches current category filter
      const eventCategories = event.tags
        .filter((tag) => tag[0] === "t" && tag[1])
        .map((tag) => tag[1])
      const matchesCategory = !category || eventCategories.includes(category)
      const matchesAdditionalTags =
        additionalTags.length === 0 ||
        additionalTags.every((tag) => eventCategories.includes(tag))

      // Only add to map if it matches the current filters AND has location data
      if (matchesCategory && matchesAdditionalTags) {
        const hasGeohash = event.tags.some((tag) => tag[0] === "g" && tag[1])
        const hasLocation = event.tags.some((tag) => tag[0] === "location" && tag[1])
        if (hasGeohash || hasLocation) {
          setMapEvents((prev) => {
            // Clear old events if filter changed
            if (lastFilterKey !== currentFilterKey) {
              setLastFilterKey(currentFilterKey)
              return [event]
            }
            if (prev.some((e) => e.id === event.id)) return prev
            return [...prev.slice(-499), event] // Keep last 500 events
          })
        }
      }

      // Track category tags for co-occurrence
      const tTags = event.tags.filter((tag) => tag[0] === "t" && tag[1])
      if (tTags.length > 0) {
        await marketStore.addTags(
          tTags.map((tag) => tag[1]),
          event.pubkey
        )
      }
    },
    [category, additionalTags, selectedGeohash, searchQuery, lastFilterKey]
  )

  // Shared feed component
  const FeedComponent = () => {
    const feedConfig = buildMarketFeedConfig(
      category,
      additionalTags,
      selectedGeohash,
      searchQuery
    )

    return (
      <Feed
        key={feedConfig.id}
        feedConfig={feedConfig}
        displayAs={displayAs}
        onDisplayAsChange={setMarketDisplayAs}
        showDisplayAsSelector={true}
        onEvent={handleMarketEvent}
      />
    )
  }

  // Generate title with category, location, and search
  const generateTitle = () => {
    let title = "Market"
    const parts = []

    if (searchQuery) {
      parts.push(`"${searchQuery}"`)
    }

    if (category) {
      parts.push(category)
    }

    if (selectedGeohash) {
      parts.push(`#${selectedGeohash}`)
    }

    if (parts.length > 0) {
      title += ": " + parts.join(" • ")
    }

    return title
  }

  const pageTitle = generateTitle()

  // If in two-column layout, only show the feed (controls are in MarketFilters in middle column)
  if (isInTwoColumnLayout) {
    return (
      <div className="flex flex-1 flex-row relative h-full">
        <div className="flex flex-col flex-1 h-full relative">
          <Header title={pageTitle} />
          <ScrollablePageContainer className="flex flex-col items-center">
            <div className="flex-1 w-full flex flex-col gap-2 md:pt-2">
              <FeedComponent />
            </div>
            <Helmet>
              <title>{pageTitle} / Iris</title>
            </Helmet>
          </ScrollablePageContainer>
        </div>
      </div>
    )
  }

  // Single column layout - show full interface
  return (
    <div className="flex flex-1 flex-row relative h-full">
      <div className="flex flex-col flex-1 h-full relative">
        <Header title={pageTitle} />
        <ScrollablePageContainer className="flex flex-col items-center">
          <div className="flex-1 w-full flex flex-col gap-2 md:pt-2">
            <MarketFilters
              mapHeight="20rem"
              categoriesHeight="h-80"
              includeSearch={true}
              mapEvents={mapEvents}
            />

            <div className="mt-4">
              <FeedComponent />
            </div>
          </div>
          <Helmet>
            <title>{pageTitle} / Iris</title>
          </Helmet>
        </ScrollablePageContainer>
      </div>
    </div>
  )
}
