import InfiniteScroll from "@/shared/components/ui/InfiniteScroll"
import {INITIAL_DISPLAY_COUNT, DISPLAY_INCREMENT} from "./utils"
import {useMemo, useCallback, useState} from "react"
import MediaModal from "../media/MediaModal"
import {AppEvent} from "@/lib/nostr"
import ImageGridItem from "./ImageGridItem"
import {useMediaExtraction} from "@/shared/hooks/useMediaExtraction"
import {useMediaModal} from "@/shared/hooks/useMediaModal"
import {useMediaCache} from "@/shared/hooks/useMediaCache"

interface MediaFeedProps {
  events: (AppEvent | {id: string})[]
  eventsToHighlight?: Set<string>
}

export default function MediaFeed({events, eventsToHighlight}: MediaFeedProps) {
  const [displayCount, setDisplayCount] = useState(INITIAL_DISPLAY_COUNT)

  // Use custom hooks for better organization
  const {calculateAllMedia} = useMediaExtraction()
  const {showModal, activeItemIndex, modalMedia, openModal, closeModal} = useMediaModal()
  const {fetchedEventsMap, handleEventFetched} = useMediaCache()

  const visibleEvents = useMemo(() => {
    return events.slice(0, displayCount)
  }, [events, displayCount])

  const loadMoreItems = useCallback(() => {
    if (events.length > displayCount) {
      setDisplayCount(displayCount + DISPLAY_INCREMENT)
      return true
    }
    return false
  }, [events.length, displayCount])

  const handleImageClick = useCallback(
    (event: AppEvent, clickedUrl: string) => {
      // Use all available events for modal, not just fetched ones
      const allFetchedEvents = Array.from(fetchedEventsMap.values())

      // Create a combined array of all events (fetched + unfetched)
      const allEvents = events
        .map((eventItem) => {
          // If we have the full event fetched, use it
          const fetchedEvent = allFetchedEvents.find((fe) => fe.id === eventItem.id)
          if (fetchedEvent) {
            return fetchedEvent
          }
          // If it's already a full event, use it
          if ("content" in eventItem && "tags" in eventItem) {
            return eventItem
          }
          // Skip unfetched events for now (they'll be fetched on demand)
          return null
        })
        .filter(Boolean) as AppEvent[]

      // Ensure the clicked event is included in allEvents
      // Only add if not already present to prevent duplicates
      if (!allEvents.find((e) => e.id === event.id)) {
        allEvents.push(event)
      }

      // Calculate media from all available events for feed-wide browsing
      const mediaArray = calculateAllMedia(allEvents)

      // Use the modal hook to open the modal
      openModal(mediaArray, event, clickedUrl)
    },
    [events, fetchedEventsMap, calculateAllMedia, openModal]
  )

  const modalMediaArray = useMemo(() => {
    return modalMedia.map((item) => ({
      id: item.url,
      url: item.url,
      type: item.type,
      event: item.event,
    }))
  }, [modalMedia])

  return (
    <>
      {showModal && activeItemIndex !== null && modalMedia.length > 0 && (
        <MediaModal
          onClose={closeModal}
          media={modalMediaArray}
          showFeedItem={true}
          currentIndex={activeItemIndex}
        />
      )}

      <InfiniteScroll onLoadMore={loadMoreItems}>
        <div className="@container">
          <div className="grid grid-cols-3 gap-px @2xl:gap-0.5 @4xl:gap-1">
            {visibleEvents.map((item, index) => (
              <ImageGridItem
                key={`${item.id}_${index}`}
                event={item}
                index={index}
                setActiveItemIndex={handleImageClick}
                onEventFetched={handleEventFetched}
                highlightAsNew={eventsToHighlight?.has(item.id) || false}
              />
            ))}
          </div>
        </div>
      </InfiniteScroll>
    </>
  )
}
