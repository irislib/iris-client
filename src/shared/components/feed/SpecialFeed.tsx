import {memo} from "react"
import InfiniteScroll from "@/shared/components/ui/InfiniteScroll"
import FeedItem from "../event/FeedItem/FeedItem"
import useSpecialFeedEvents from "@/shared/hooks/useSpecialFeedEvents"

const SpecialFeed = memo(function SpecialFeed() {
  const {events, loadMore, loading} = useSpecialFeedEvents()

  if (events.length === 0 && loading) {
    return (
      <div className="p-8 flex items-center justify-center text-base-content/50">
        Loading popular posts...
      </div>
    )
  }

  if (events.length === 0 && !loading) {
    return (
      <div className="p-8 flex items-center justify-center text-base-content/50">
        No popular posts found.
      </div>
    )
  }

  return (
    <InfiniteScroll onLoadMore={loadMore}>
      {events.map((event) => (
        <FeedItem key={event.id} event={event} />
      ))}
    </InfiniteScroll>
  )
})

export default SpecialFeed
