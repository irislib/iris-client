import {useMemo, useState, useEffect, useRef} from "react"
import RightColumn from "@/shared/components/RightColumn.tsx"
import Header from "@/shared/components/header/Header"
import AlgorithmicFeed from "@/shared/components/feed/AlgorithmicFeed"
import {SocialGraphWidget} from "@/shared/components/SocialGraphWidget"
import {RelayStats} from "@/shared/components/RelayStats"
import {EventFilter} from "@/lib/nostr"
import Feed from "@/shared/components/feed/Feed.tsx"
import {useParams, useNavigate} from "@/navigation"
import Widget from "@/shared/components/ui/Widget"
import {Helmet} from "react-helmet"
import RelaySelector from "@/shared/components/ui/RelaySelector"
import RelayDetails from "@/shared/components/relay/RelayDetails"
import {KIND_TEXT_NOTE} from "@/utils/constants"
import {useIsTwoColumnLayout} from "@/shared/hooks/useIsTwoColumnLayout"
import {ScrollablePageContainer} from "@/shared/components/layout/ScrollablePageContainer"
import {useSearchStore} from "@/stores/search"

function RelayPage() {
  const {url} = useParams()
  const navigate = useNavigate()
  const isInTwoColumnLayout = useIsTwoColumnLayout()
  const decodedRelay = url ? decodeURIComponent(url) : ""
  const urlRelayUrl = decodedRelay ? `wss://${decodedRelay}` : ""
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Use persisted state in two-column layout
  const storedRelayUrl = useSearchStore((state) => state.selectedRelayUrl)
  const setStoredRelayUrl = useSearchStore((state) => state.setSelectedRelayUrl)
  const [localRelayUrl, setLocalRelayUrl] = useState(urlRelayUrl)

  // Use URL if provided, otherwise use stored value in two-column layout
  const selectedRelayUrl = isInTwoColumnLayout
    ? urlRelayUrl || storedRelayUrl
    : urlRelayUrl || localRelayUrl
  const setSelectedRelayUrl = isInTwoColumnLayout ? setStoredRelayUrl : setLocalRelayUrl

  const relayDisplayName = selectedRelayUrl
    ? selectedRelayUrl.replace(/^(https?:\/\/)?(wss?:\/\/)?/, "").replace(/\/$/, "")
    : ""

  // Update stored relay when URL changes in two-column layout
  useEffect(() => {
    if (urlRelayUrl) {
      if (isInTwoColumnLayout) {
        setStoredRelayUrl(urlRelayUrl)
      } else {
        setLocalRelayUrl(urlRelayUrl)
      }
    }
  }, [urlRelayUrl, isInTwoColumnLayout, setStoredRelayUrl])

  // Use shared state from store for two-column layout consistency
  const storeShowEventsByUnknownUsers = useSearchStore(
    (state) => state.showEventsByUnknownUsers
  )
  const storeSetShowEventsByUnknownUsers = useSearchStore(
    (state) => state.setShowEventsByUnknownUsers
  )
  const [localShowEventsByUnknownUsers, setLocalShowEventsByUnknownUsers] = useState(true)

  const showEventsByUnknownUsers = isInTwoColumnLayout
    ? storeShowEventsByUnknownUsers
    : localShowEventsByUnknownUsers
  const setShowEventsByUnknownUsers = isInTwoColumnLayout
    ? storeSetShowEventsByUnknownUsers
    : setLocalShowEventsByUnknownUsers

  const filters: EventFilter = useMemo(
    () => ({
      kinds: [KIND_TEXT_NOTE],
      limit: 100,
    }),
    []
  )

  // In two-column layout, only show the feed (selector is in middle column)
  if (isInTwoColumnLayout) {
    return (
      <div className="flex flex-1 flex-row relative h-full">
        <div className="flex flex-col flex-1 h-full relative">
          <Header title={decodedRelay ? `Relay: ${relayDisplayName}` : "Relay Feed"} />
          <ScrollablePageContainer className="flex flex-col items-center">
            <div className="flex-1 w-full flex flex-col gap-2 md:pt-2">
              {selectedRelayUrl ? (
                <Feed
                  key={selectedRelayUrl}
                  feedConfig={{
                    name: "Relay Feed",
                    id: `relay-${selectedRelayUrl}`,
                    showRepliedTo: true,
                    followDistance: showEventsByUnknownUsers ? undefined : 5,
                    sortType: "chronological",
                    relayUrls: [selectedRelayUrl],
                    filter: filters,
                  }}
                />
              ) : (
                <div className="p-4">
                  <RelayStats />
                </div>
              )}
            </div>
            <Helmet>
              <title>
                {decodedRelay ? `Relay: ${relayDisplayName}` : "Relay Feed"} / Iris
              </title>
            </Helmet>
          </ScrollablePageContainer>
        </div>
      </div>
    )
  }

  // Single column layout - show full interface
  return (
    <div className="flex flex-row h-screen">
      <div className="flex flex-col items-center flex-1 h-full relative">
        <div
          className="w-full max-w-screen-lg"
          onClick={() =>
            scrollContainerRef.current?.scrollTo({top: 0, behavior: "instant"})
          }
        >
          <Header title={decodedRelay ? `Relay: ${relayDisplayName}` : "Relay Feed"} />
        </div>
        <div
          ref={scrollContainerRef}
          className="p-2 flex-1 w-full max-w-screen-lg flex flex-col gap-4 pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))] md:pt-16 lg:pt-2 md:pb-0 overflow-y-auto"
        >
          <RelaySelector
            selectedRelay={selectedRelayUrl}
            onRelaySelect={(newRelay) => {
              setSelectedRelayUrl(newRelay)
              const cleanUrl = newRelay
                .replace(/^(https?:\/\/)?(wss?:\/\/)?/, "")
                .replace(/\/$/, "") // Remove trailing slash
              navigate(`/relay/${encodeURIComponent(cleanUrl)}`, {replace: true})
            }}
            placeholder="Select a relay"
          />

          <RelayDetails relayUrl={selectedRelayUrl} />

          {selectedRelayUrl && (
            <>
              <div className="flex items-center gap-2 p-2">
                <input
                  type="checkbox"
                  className="toggle toggle-sm"
                  checked={showEventsByUnknownUsers}
                  onChange={(e) => setShowEventsByUnknownUsers(e.target.checked)}
                />
                <span className="text-sm">Show posts from unknown users</span>
              </div>

              <Feed
                key={selectedRelayUrl}
                feedConfig={{
                  name: "Relay Feed",
                  id: `relay-${selectedRelayUrl}`,
                  showRepliedTo: true,
                  followDistance: showEventsByUnknownUsers ? undefined : 5,
                  sortType: "chronological",
                  relayUrls: [selectedRelayUrl],
                  filter: filters,
                }}
              />
            </>
          )}

          {!selectedRelayUrl && (
            <div className="text-center py-8 text-base-content/50">
              Select a relay to view its feed
            </div>
          )}
        </div>
        <Helmet>
          <title>
            {decodedRelay ? `Relay: ${relayDisplayName}` : "Relay Feed"} / Iris
          </title>
        </Helmet>
      </div>
      <RightColumn>
        {() => (
          <>
            <SocialGraphWidget />
            <RelayStats />
            <Widget title="Popular" className="h-96">
              <AlgorithmicFeed
                type="popular"
                displayOptions={{
                  small: true,
                  showDisplaySelector: false,
                }}
              />
            </Widget>
          </>
        )}
      </RightColumn>
    </div>
  )
}

export default RelayPage
