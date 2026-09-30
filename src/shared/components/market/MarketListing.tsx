import {extractMarketData} from "@/shared/utils/marketUtils"
import ErrorBoundary from "../ui/ErrorBoundary"
import {AppEvent} from "@/lib/nostr"
import MarketDetails from "./MarketDetails"
import MarketImage from "./MarketImage"
import HyperText from "../HyperText"
import {CategoryLabel} from "./CategoryLabel"
import {useNavigate} from "@/navigation"

type MarketListingProps = {
  event: AppEvent
  truncate?: number
  isTruncated?: boolean
}

/**
 * Component to display category tags
 */
function CategoryTags({
  event,
  showCategories,
}: {
  event: AppEvent
  showCategories: boolean
}) {
  const navigate = useNavigate()

  if (!showCategories) return null

  const categoryTags = event.tags.filter((tag) => tag[0] === "t" && tag[1])

  if (categoryTags.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {categoryTags.map((tag, index) => (
        <CategoryLabel
          key={`${tag[1]}-${index}`}
          category={tag[1]}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            navigate(`/m/${encodeURIComponent(tag[1])}`)
          }}
        />
      ))}
    </div>
  )
}

/**
 * Component for truncated market listings
 */
function TruncatedMarketListing({event}: {event: AppEvent}) {
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
            <CategoryTags event={event} showCategories={false} />
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}

/**
 * Component for full market listings
 */
function FullMarketListing({
  event,
  isStandalone,
}: {
  event: AppEvent
  isStandalone: boolean
}) {
  const {title, price, imageUrl, content, tags} = extractMarketData(event)

  return (
    <ErrorBoundary>
      <div className="px-4 @container">
        <div className="flex flex-col @2xl:flex-row gap-4">
          <div className="flex flex-row @2xl:flex-col gap-2">
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

            <CategoryTags event={event} showCategories={isStandalone} />
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
  // Item is standalone when it's not truncated (no truncate value or truncate is 0)
  const isStandalone = !truncate || truncate === 0

  if (shouldTruncate) {
    return <TruncatedMarketListing event={event} />
  }
  return <FullMarketListing event={event} isStandalone={isStandalone} />
}

export default MarketListing
