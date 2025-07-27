import {extractMarketData} from "@/shared/utils/marketUtils"
import ErrorBoundary from "../ui/ErrorBoundary"
import {NostrEvent} from "nostr-tools"
import MarketDetails from "./MarketDetails"
import MarketImage from "./MarketImage"
import HyperText from "../HyperText"

type MarketListingProps = {
  event: NostrEvent
  truncate?: number
  isTruncated?: boolean
}

/**
 * Component for truncated market listings
 */
function TruncatedMarketListing({event}: {event: NostrEvent}) {
  const {title, price, imageUrl, summary} = extractMarketData(event)

  return (
    <ErrorBoundary>
      <div className="px-4">
        <div className="flex gap-4">
          <MarketImage event={event} imageUrl={imageUrl} className="w-40" />
          <div className="flex-1">
            {price && <div className="text-lg font-bold mb-2">{price}</div>}
            {(title || summary) && (
              <div className="text-md text-base-content mb-4">{title || summary}</div>
            )}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}

/**
 * Component for full market listings
 */
function FullMarketListing({event}: {event: NostrEvent}) {
  const {title, price, imageUrl, content, tags} = extractMarketData(event)

  return (
    <ErrorBoundary>
      <div className="px-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex flex-row md:flex-col gap-2">
            <MarketImage event={event} imageUrl={imageUrl} className="w-40" />
            {price && (
              <div className="text-2xl font-bold mb-2 flex justify-center items-center w-full">
                {price}
              </div>
            )}
          </div>
          <div className="flex-1">
            {title && (
              <div className="text-lg font-bold text-base-content mb-4">{title}</div>
            )}

            <HyperText event={event} textPadding={false}>
              {content}
            </HyperText>
          </div>
        </div>
        <MarketDetails tags={tags} />
      </div>
    </ErrorBoundary>
  )
}

/**
 * Main component that decides which version to render
 */
function MarketListing({event, truncate, isTruncated}: MarketListingProps) {
  // Use isTruncated prop if provided, otherwise fall back to truncate check
  const shouldTruncate = isTruncated !== undefined ? isTruncated : !!truncate
  if (shouldTruncate) {
    return <TruncatedMarketListing event={event} />
  }
  return <FullMarketListing event={event} />
}

export default MarketListing
