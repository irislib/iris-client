import InfiniteScroll from "@/shared/components/ui/InfiniteScroll"
import {useState, useRef, useCallback, useMemo} from "react"
import FeedItem from "../event/FeedItem/FeedItem"
import {NostrEvent} from "nostr-tools"
import {DISPLAY_INCREMENT} from "./utils"

interface UnknownUserEventsProps {
  eventsByUnknownUsers: NostrEvent[]
  showRepliedTo: boolean
  asReply: boolean
}

const UnknownUserEvents = ({
  eventsByUnknownUsers,
  showRepliedTo,
  asReply,
}: UnknownUserEventsProps) => {
  const [displayCount, setDisplayCount] = useState(DISPLAY_INCREMENT)
  const firstFeedItemRef = useRef<HTMLDivElement | null>(null)

  const loadMoreItems = useCallback(() => {
    if (eventsByUnknownUsers.length > displayCount) {
      setDisplayCount(displayCount + DISPLAY_INCREMENT)
    }
  }, [displayCount, eventsByUnknownUsers.length])

  const displayedEvents = useMemo(() => {
    return eventsByUnknownUsers.slice(0, displayCount)
  }, [eventsByUnknownUsers, displayCount])

  return (
    <InfiniteScroll onLoadMore={loadMoreItems}>
      {displayedEvents.map((event, index) => (
        <div key={event.id} ref={index === 0 ? firstFeedItemRef : null}>
          <FeedItem
            asReply={asReply}
            showRepliedTo={showRepliedTo}
            key={event.id}
            event={event}
          />
        </div>
      ))}
    </InfiniteScroll>
  )
}

export default UnknownUserEvents
