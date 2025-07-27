import {useMemo, useState, useEffect} from "react"
import RightColumn from "@/shared/components/RightColumn.tsx"
import Header from "@/shared/components/header/Header"
import useHistoryState from "@/shared/hooks/useHistoryState"
import PopularFeed from "@/shared/components/feed/PopularFeed"
import {Filter} from "nostr-tools"
import Feed from "@/shared/components/feed/Feed.tsx"
import {useParams} from "react-router"
import Widget from "@/shared/components/ui/Widget"
import {DEFAULT_RELAYS} from "@/utils/applesauce"
import {useSettingsStore} from "@/stores/settings"
import {Helmet} from "react-helmet"
import RelaySelector from "@/shared/components/ui/RelaySelector"

function RelayPage() {
  const {relay} = useParams()
  const selectedRelay = relay || ""
  const relayDisplayName = selectedRelay.replace(/^(https?:\/\/)?(wss?:\/\/)?/, "")

  const [displayedRelay, setDisplayedRelay] = useState("")

  const {content} = useSettingsStore()
  const [showEventsByUnknownUsers, setShowEventsByUnknownUsers] = useHistoryState(
    !content.hideEventsByUnknownUsers,
    "relayShowEventsByUnknownUsers"
  )

  useEffect(() => {
    setDisplayedRelay(selectedRelay || DEFAULT_RELAYS[0])
  }, [selectedRelay])

  const filters: Filter = useMemo(
    () => ({
      kinds: [1],
      limit: 100,
    }),
    []
  )

  return (
    <div className="flex flex-row">
      <div className="flex flex-col items-center flex-1">
        <Header title={selectedRelay ? `Relay: ${relayDisplayName}` : "Relay Feed"} />
        <div className="p-2 flex-1 w-full max-w-screen-lg flex flex-col gap-4">
          <RelaySelector
            selectedRelay={displayedRelay}
            onRelaySelect={(newRelay) => {
              window.location.href = `/relay/${encodeURIComponent(newRelay)}`
            }}
            placeholder="Select a relay"
          />

          {selectedRelay && (
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
                key={selectedRelay}
                filters={filters}
                showRepliedTo={false}
                cacheKey={`relay-${selectedRelay}`}
                relayUrls={[selectedRelay]}
                showEventsByUnknownUsers={showEventsByUnknownUsers}
              />
            </>
          )}

          {!selectedRelay && (
            <div className="text-center py-8 text-base-content/50">
              Select a relay to view its feed
            </div>
          )}

          <div className="mt-8">
            <PopularFeed small={false} />
          </div>
        </div>
        <Helmet>
          <title>
            {selectedRelay ? `Relay: ${relayDisplayName}` : "Relay Feed"} / Iris
          </title>
        </Helmet>
      </div>
      <RightColumn>
        {() => (
          <>
            <Widget title="Popular">
              <PopularFeed />
            </Widget>
          </>
        )}
      </RightColumn>
    </div>
  )
}

export default RelayPage
