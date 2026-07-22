import {memo} from "react"
import EventBorderless from "@/shared/components/event/EventBorderless"
import FeedItem from "@/shared/components/event/FeedItem/FeedItem"
import InfiniteScroll from "@/shared/components/ui/InfiniteScroll"
import MediaFeed from "./MediaFeed"
import {DisplayAsSelector} from "./DisplayAsSelector"
import ZapAllButton from "./ZapAllButton"
import {NDKEvent} from "@/lib/ndk"

interface FeedWidgetProps {
  events: NDKEvent[]
  loading: boolean
  loadMore?: () => void
  displayAs?: "list" | "grid" | "borderless"
  showDisplaySelector?: boolean
  onDisplayAsChange?: (display: "list" | "grid") => void
  emptyMessage?: string
  loadingMessage?: string
  maxItems?: number
  small?: boolean
  scrollContainer?: HTMLDivElement | null
  forceShowZapAll?: boolean
  showZapAll?: boolean
}

const FeedWidget = memo(function FeedWidget({
  events,
  loading,
  loadMore,
  displayAs = "borderless",
  showDisplaySelector = false,
  onDisplayAsChange,
  emptyMessage = "No posts found",
  loadingMessage = "",
  maxItems,
  small = true,
  scrollContainer = null,
  forceShowZapAll = false,
  showZapAll = false,
}: FeedWidgetProps) {
  const displayEvents = maxItems ? events.slice(0, maxItems) : events

  if (loading && events.length === 0) {
    return loadingMessage ? (
      <div className={small ? "px-4 py-2" : "p-8 flex items-center justify-center"}>
        <span className="text-base-content/50 text-sm">{loadingMessage}</span>
      </div>
    ) : null
  }

  if (displayEvents.length === 0) {
    // Don't wrap empty content in InfiniteScroll - it causes endless loops
    // Only show empty message if we're not currently loading
    return !loading ? (
      <div className={small ? "px-4 py-2" : "p-8 flex items-center justify-center"}>
        <span className="text-base-content/50 text-sm">{emptyMessage}</span>
      </div>
    ) : null
  }

  const renderEvents = () => {
    if (displayAs === "borderless") {
      return (
        <div className="flex flex-col gap-4">
          {displayEvents.map((event) => (
            <EventBorderless key={event.id} event={event} />
          ))}
        </div>
      )
    }

    if (displayAs === "grid") {
      return <MediaFeed events={displayEvents} />
    }

    // displayAs === "list"
    return displayEvents.map((event) => <FeedItem key={event.id} event={event} />)
  }

  return (
    <>
      {showDisplaySelector && onDisplayAsChange && (
        <DisplayAsSelector
          activeSelection={displayAs as "list" | "grid"}
          onSelect={onDisplayAsChange}
        />
      )}

      {(showZapAll || forceShowZapAll) && events.length > 0 && (
        <ZapAllButton events={events} />
      )}

      {loadMore ? (
        <InfiniteScroll onLoadMore={loadMore} scrollContainer={scrollContainer}>
          {renderEvents()}
        </InfiniteScroll>
      ) : (
        renderEvents()
      )}
    </>
  )
})

export default FeedWidget
