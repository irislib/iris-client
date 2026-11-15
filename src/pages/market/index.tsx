import {useParams} from "@/navigation"
import {useMemo, useState} from "react"
import Feed from "@/shared/components/feed/Feed"
import {useUIStore} from "@/stores/ui"
import Header from "@/shared/components/header/Header"
import {ScrollablePageContainer} from "@/shared/components/layout/ScrollablePageContainer"
import {Helmet} from "react-helmet"
import {AppEvent} from "@/lib/nostr"
import MarketFilters from "./components/MarketFilters"
import {marketStore} from "@/stores/marketstore"
import {buildMarketFeedConfig} from "./utils"

export default function MarketPage() {
  const {category} = useParams()
  const displayAs = useUIStore((state) => state.marketDisplayAs)
  const setMarketDisplayAs = useUIStore((state) => state.setMarketDisplayAs)
  const params = new URLSearchParams(window.location.search)
  const selectedGeohash = params.get("g") || undefined
  const searchQuery = params.get("q") || undefined
  const tags = params.get("t")
  const additionalTags = useMemo(() => tags?.split(",").filter(Boolean) ?? [], [tags])
  const feedConfig = useMemo(
    () => buildMarketFeedConfig(category, additionalTags, selectedGeohash, searchQuery),
    [category, additionalTags, selectedGeohash, searchQuery]
  )
  const [map, setMap] = useState<{feed: string; events: AppEvent[]}>({
    feed: feedConfig.id,
    events: [],
  })
  const titleParts = [
    searchQuery && `"${searchQuery}"`,
    category,
    selectedGeohash && `#${selectedGeohash}`,
  ].filter(Boolean)
  const pageTitle = titleParts.length ? `Market: ${titleParts.join(" • ")}` : "Market"

  const handleMarketEvent = (event: AppEvent) => {
    const eventTags = event.tags
      .filter(([key, tag]) => key === "t" && tag)
      .map(([, tag]) => tag)
    const matchesCategory = !category || eventTags.includes(category)
    const hasLocation = event.tags.some(
      ([key, value]) => (key === "g" || key === "location") && value
    )
    if (
      hasLocation &&
      matchesCategory &&
      additionalTags.every((tag) => eventTags.includes(tag))
    ) {
      setMap((previous) => ({
        feed: feedConfig.id,
        events:
          previous.feed === feedConfig.id
            ? [...previous.events.slice(-499), event]
            : [event],
      }))
    }
    if (eventTags.length) void marketStore.addTags(eventTags, event.pubkey)
  }

  return (
    <div className="flex flex-col flex-1 h-full relative">
      <Header title={pageTitle} />
      <ScrollablePageContainer className="flex flex-col items-center">
        <div className="flex-1 w-full flex flex-col gap-2 md:pt-2">
          <MarketFilters mapEvents={map.feed === feedConfig.id ? map.events : []} />
          <div className="mt-4">
            <Feed
              key={feedConfig.id}
              feedConfig={feedConfig}
              displayAs={displayAs}
              onDisplayAsChange={setMarketDisplayAs}
              showDisplayAsSelector
              onEvent={handleMarketEvent}
            />
          </div>
        </div>
        <Helmet>
          <title>{pageTitle} / Iris</title>
        </Helmet>
      </ScrollablePageContainer>
    </div>
  )
}
