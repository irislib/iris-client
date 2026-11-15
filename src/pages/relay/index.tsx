import {useState, useRef} from "react"
import RightColumn from "@/shared/components/RightColumn.tsx"
import Header from "@/shared/components/header/Header"
import PopularWidget from "@/shared/components/feed/PopularWidget"
import {SocialGraphWidget} from "@/shared/components/SocialGraphWidget"
import Feed from "@/shared/components/feed/Feed.tsx"
import {useParams, useNavigate} from "@/navigation"
import {Helmet} from "react-helmet"
import SearchTabSelector from "@/shared/components/search/SearchTabSelector"
import RelaySelector from "@/shared/components/ui/RelaySelector"
import RelayDetails from "@/shared/components/relay/RelayDetails"
import {KIND_TEXT_NOTE} from "@/utils/constants"

const relayFilter = {kinds: [KIND_TEXT_NOTE], limit: 100}

function RelayPage() {
  const {url} = useParams()
  const navigate = useNavigate()
  const relayName = url ? decodeURIComponent(url).replace(/\/$/, "") : ""
  const selectedRelayUrl = relayName ? `wss://${relayName}` : ""
  const title = relayName ? `Relay: ${relayName}` : "Relay Feed"
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [showEventsByUnknownUsers, setShowEventsByUnknownUsers] = useState(true)

  return (
    <div className="flex flex-row h-screen">
      <div className="flex flex-col items-center flex-1 h-full relative">
        <div
          className="w-full max-w-screen-lg"
          onClick={() =>
            scrollContainerRef.current?.scrollTo({top: 0, behavior: "instant"})
          }
        >
          <Header title={title} />
        </div>
        <div
          ref={scrollContainerRef}
          className="p-2 flex-1 w-full max-w-screen-lg flex flex-col gap-4 pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))] md:pt-16 lg:pt-2 md:pb-0 overflow-y-auto"
        >
          <SearchTabSelector activeTab="relay" />
          <RelaySelector
            selectedRelay={selectedRelayUrl}
            onRelaySelect={(newRelay) => {
              const cleanUrl = newRelay
                .replace(/^(https?:\/\/)?(wss?:\/\/)?/, "")
                .replace(/\/$/, "")
              navigate(cleanUrl ? `/relay/${encodeURIComponent(cleanUrl)}` : "/relay", {
                replace: true,
              })
            }}
          />

          <RelayDetails relayUrl={selectedRelayUrl} />

          {selectedRelayUrl ? (
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
                  filter: relayFilter,
                }}
              />
            </>
          ) : (
            <div className="text-center py-8 text-base-content/50">
              Select a relay to view its feed
            </div>
          )}
        </div>
        <Helmet>
          <title>{title} / Iris</title>
        </Helmet>
      </div>
      <RightColumn>
        <SocialGraphWidget />
        <PopularWidget />
      </RightColumn>
    </div>
  )
}

export default RelayPage
