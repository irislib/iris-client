import {useMemo, useState, useEffect} from "react"
import {useParams, useNavigate} from "react-router"
import {NDKFilter} from "@nostr-dev-kit/ndk"
import {Helmet} from "react-helmet"

import RightColumn from "@/shared/components/RightColumn.tsx"
import PopularFeed from "@/shared/components/feed/PopularFeed"
import Header from "@/shared/components/header/Header"
import Feed from "@/shared/components/feed/Feed.tsx"
import Widget from "@/shared/components/ui/Widget"
import {DEFAULT_RELAYS} from "@/utils/ndk"

function RelayPage() {
  const {url} = useParams()
  const navigate = useNavigate()
  const [selectedRelay, setSelectedRelay] = useState<string>("")
  const [customRelay, setCustomRelay] = useState<string>("")
  const [showCustomInput, setShowCustomInput] = useState(false)

  useEffect(() => {
    if (url) {
      let normalizedUrl = url
      if (!normalizedUrl.startsWith("wss://") && !normalizedUrl.startsWith("ws://")) {
        normalizedUrl = `wss://${normalizedUrl}`
      }
      normalizedUrl = normalizedUrl.replace(/\/$/, "")
      setSelectedRelay(normalizedUrl)
    }
  }, [url])

  const filters: NDKFilter = useMemo(
    () => ({
      kinds: [1],
      limit: 100,
    }),
    []
  )

  const handleRelaySelect = (relayUrl: string) => {
    if (relayUrl === "custom") {
      setShowCustomInput(true)
      return
    }
    setSelectedRelay(relayUrl)
    setShowCustomInput(false)
    const urlParam = relayUrl
      .replace("wss://", "")
      .replace("ws://", "")
      .replace(/\/$/, "")
    navigate(`/relay/${urlParam}`)
  }

  const handleCustomRelaySubmit = () => {
    if (!customRelay.trim()) return
    let normalizedUrl = customRelay.trim()
    if (!normalizedUrl.startsWith("wss://") && !normalizedUrl.startsWith("ws://")) {
      normalizedUrl = `wss://${normalizedUrl}`
    }
    normalizedUrl = normalizedUrl.replace(/\/$/, "")
    setSelectedRelay(normalizedUrl)
    setShowCustomInput(false)
    const urlParam = normalizedUrl
      .replace("wss://", "")
      .replace("ws://", "")
      .replace(/\/$/, "")
    navigate(`/relay/${urlParam}`)
    setCustomRelay("")
  }

  const relayDisplayName = selectedRelay
    ? selectedRelay.replace("wss://", "").replace("ws://", "").replace(/\/$/, "")
    : "Select Relay"

  return (
    <div className="flex flex-row">
      <div className="flex flex-col items-center flex-1">
        <Header title={selectedRelay ? `Relay: ${relayDisplayName}` : "Relay Feed"} />
        <div className="p-2 flex-1 w-full max-w-screen-lg flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <select
              className="select select-bordered w-full max-w-xs"
              value={selectedRelay || ""}
              onChange={(e) => handleRelaySelect(e.target.value)}
            >
              <option value="">Select a relay</option>
              {DEFAULT_RELAYS.map((relay) => (
                <option key={relay} value={relay}>
                  {relay.replace("wss://", "").replace(/\/$/, "")}
                </option>
              ))}
              <option value="custom">Custom relay...</option>
            </select>

            {showCustomInput && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="wss://relay.example.com"
                  className="input input-bordered flex-1"
                  value={customRelay}
                  onChange={(e) => setCustomRelay(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && handleCustomRelaySubmit()}
                />
                <button className="btn btn-primary" onClick={handleCustomRelaySubmit}>
                  Connect
                </button>
              </div>
            )}
          </div>

          {selectedRelay && (
            <Feed
              key={selectedRelay}
              filters={filters}
              showRepliedTo={false}
              showFilters={true}
              cacheKey={`relay-${selectedRelay}`}
              relayUrls={[selectedRelay]}
            />
          )}

          {!selectedRelay && (
            <div className="mt-4">
              <PopularFeed small={false} />
            </div>
          )}
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
