import {useCallback, useEffect, useMemo, useRef, useState} from "react"
import {NDKEvent} from "@nostr-dev-kit/ndk"
import useHistoryState from "@/shared/hooks/useHistoryState"
import MediaModal from "../media/MediaModal"
import ImageGridItem from "./ImageGridItem"
import {useMediaExtraction} from "@/shared/hooks/useMediaExtraction"
import {useMediaModal} from "@/shared/hooks/useMediaModal"
import {useMediaCache} from "@/shared/hooks/useMediaCache"

interface MediaFeedProps {
  events: (NDKEvent | {id: string})[]
  eventsToHighlight?: Set<string>
  onNewEventsShown?: () => void
  onBottomVisibleTimestampChange?: (timestamp: number) => void
}

const GRID_COLUMNS = 3
const ITEM_HEIGHT = window.innerWidth <= 767 ? window.innerWidth / 3 : 245
const BUFFER_SIZE = 10 // Render extra rows above/below viewport
const SCROLL_DEBOUNCE = 100
const OVERSCAN = 5 // Extra items to render for smooth scrolling

export default function VirtualizedMediaFeed({
  events,
  eventsToHighlight,
  onNewEventsShown,
  onBottomVisibleTimestampChange,
}: MediaFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollPositionRef = useRef(0)
  const [visibleRange, setVisibleRange] = useState({start: 0, end: 20})
  const [containerHeight, setContainerHeight] = useState(0)

  // Store scroll position in history state for back navigation
  const [savedScrollPosition, setSavedScrollPosition] = useHistoryState(
    0,
    "scrollPosition"
  )

  // Use custom hooks for better organization
  const {calculateAllMedia} = useMediaExtraction()
  const {showModal, activeItemIndex, modalMedia, openModal, closeModal} = useMediaModal()
  const {fetchedEventsMap, handleEventFetched} = useMediaCache()

  // Calculate total rows and height
  const totalRows = Math.ceil(events.length / GRID_COLUMNS)
  const totalHeight = totalRows * ITEM_HEIGHT

  // Get visible items based on scroll position with overscan
  const visibleItems = useMemo(() => {
    const startRow = Math.max(0, visibleRange.start - BUFFER_SIZE)
    const endRow = Math.min(totalRows, visibleRange.end + BUFFER_SIZE + OVERSCAN)
    const startIndex = startRow * GRID_COLUMNS
    const endIndex = Math.min(events.length, endRow * GRID_COLUMNS)

    return events.slice(startIndex, endIndex).map((event, index) => ({
      event,
      index: startIndex + index,
      row: Math.floor((startIndex + index) / GRID_COLUMNS),
      column: (startIndex + index) % GRID_COLUMNS,
    }))
  }, [events, visibleRange, totalRows])

  // Handle scroll with debouncing
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return

    const scrollTop = window.scrollY - containerRef.current.offsetTop
    scrollPositionRef.current = scrollTop

    const startRow = Math.floor(scrollTop / ITEM_HEIGHT)
    const visibleRows = Math.ceil(containerHeight / ITEM_HEIGHT)
    const endRow = startRow + visibleRows

    setVisibleRange({start: startRow, end: endRow})
    setSavedScrollPosition(scrollTop)

    // Update bottom visible timestamp
    if (onBottomVisibleTimestampChange && events.length > 0) {
      const bottomVisibleIndex = Math.min(endRow * GRID_COLUMNS, events.length - 1)
      const bottomEvent = events[bottomVisibleIndex]
      if (bottomEvent && "created_at" in bottomEvent) {
        onBottomVisibleTimestampChange(bottomEvent.created_at || 0)
      }
    }
  }, [containerHeight, setSavedScrollPosition, events, onBottomVisibleTimestampChange])

  // Debounced scroll handler
  useEffect(() => {
    let timeoutId: number
    const debouncedScroll = () => {
      clearTimeout(timeoutId)
      timeoutId = window.setTimeout(handleScroll, SCROLL_DEBOUNCE)
    }

    window.addEventListener("scroll", debouncedScroll)
    return () => {
      clearTimeout(timeoutId)
      window.removeEventListener("scroll", debouncedScroll)
    }
  }, [handleScroll])

  // Update container height on resize
  useEffect(() => {
    const updateHeight = () => {
      setContainerHeight(window.innerHeight)
    }

    updateHeight()
    window.addEventListener("resize", updateHeight)
    return () => window.removeEventListener("resize", updateHeight)
  }, [])

  // Restore scroll position on mount
  useEffect(() => {
    if (savedScrollPosition > 0 && containerRef.current) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        window.scrollTo(0, containerRef.current!.offsetTop + savedScrollPosition)
      })
    } else {
      // Set initial bottom visible timestamp
      handleScroll()
    }
  }, [])

  // Handle new events shown - reset scroll position when new events are added
  useEffect(() => {
    if (eventsToHighlight && eventsToHighlight.size > 0) {
      // New events were added, scroll to top
      setSavedScrollPosition(0)
      window.scrollTo(0, 0)
      onNewEventsShown?.()
    }
  }, [eventsToHighlight])

  const handleImageClick = useCallback(
    (event: NDKEvent, clickedUrl: string) => {
      const allFetchedEvents = Array.from(fetchedEventsMap.values())
      const allEvents = events
        .map((eventItem) => {
          const fetchedEvent = allFetchedEvents.find((fe) => fe.id === eventItem.id)
          if (fetchedEvent) return fetchedEvent
          if ("content" in eventItem && "tags" in eventItem) return eventItem
          return null
        })
        .filter(Boolean) as NDKEvent[]

      if (!allEvents.find((e) => e.id === event.id)) {
        allEvents.push(event)
      }

      const mediaArray = calculateAllMedia(allEvents)
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

      <div ref={containerRef} style={{height: totalHeight, position: "relative"}}>
        <div className="grid grid-cols-3 gap-px md:gap-1">
          {visibleItems.map(({event, index, row, column}) => (
            <div
              key={`${event.id}_${index}`}
              style={{
                position: "absolute",
                top: row * ITEM_HEIGHT,
                left: `${(column * 100) / GRID_COLUMNS}%`,
                width: `${100 / GRID_COLUMNS}%`,
                height: ITEM_HEIGHT,
              }}
            >
              <ImageGridItem
                event={event}
                index={index}
                setActiveItemIndex={handleImageClick}
                onEventFetched={handleEventFetched}
                highlightAsNew={eventsToHighlight?.has(event.id) || false}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
