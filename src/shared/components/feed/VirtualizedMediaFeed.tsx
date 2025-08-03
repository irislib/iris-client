import {useCallback, useEffect, useMemo, useRef, useState, memo} from "react"
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
const ITEM_HEIGHT = window.innerWidth <= 767 ? Math.floor(window.innerWidth / 3) : 245
const BUFFER_ROWS = 3 // Reduced buffer for faster rendering
const SCROLL_DEBOUNCE = 50 // Reduced debounce for more responsive scrolling

// Memoized grid item wrapper for better performance
const MemoizedGridItem = memo(ImageGridItem)

function VirtualizedMediaFeed({
  events,
  eventsToHighlight,
  onNewEventsShown,
  onBottomVisibleTimestampChange,
}: MediaFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollPositionRef = useRef(0)
  const isInitialMount = useRef(true)

  // Initialize visible range based on saved scroll position
  const [savedScrollPosition, setSavedScrollPosition] = useHistoryState(
    0,
    "scrollPosition"
  )

  // Calculate initial visible range from saved scroll position
  const getInitialVisibleRange = () => {
    const startRow = Math.floor(savedScrollPosition / ITEM_HEIGHT)
    const visibleRowCount = Math.ceil(window.innerHeight / ITEM_HEIGHT)
    return {startRow, endRow: startRow + visibleRowCount}
  }

  const [visibleRange, setVisibleRange] = useState(getInitialVisibleRange)
  const [containerHeight, setContainerHeight] = useState(window.innerHeight)

  // Use custom hooks for better organization
  const {calculateAllMedia} = useMediaExtraction()
  const {showModal, activeItemIndex, modalMedia, openModal, closeModal} = useMediaModal()
  const {fetchedEventsMap, handleEventFetched} = useMediaCache()

  // Calculate total rows
  const totalRows = Math.ceil(events.length / GRID_COLUMNS)

  // Get visible items based on scroll position - with optimized memoization
  const visibleItems = useMemo(() => {
    const startRow = Math.max(0, visibleRange.startRow - BUFFER_ROWS)
    const endRow = Math.min(totalRows, visibleRange.endRow + BUFFER_ROWS)
    const startIndex = startRow * GRID_COLUMNS
    const endIndex = Math.min(events.length, endRow * GRID_COLUMNS)

    // Only map the visible slice
    return {
      items: events.slice(startIndex, endIndex).map((event, i) => ({
        event,
        index: startIndex + i,
      })),
      startOffset: startRow * ITEM_HEIGHT,
      endOffset: Math.max(0, (totalRows - endRow) * ITEM_HEIGHT),
    }
  }, [events, visibleRange.startRow, visibleRange.endRow, totalRows])

  // Handle scroll with optimized debouncing
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return

    const scrollTop = window.scrollY - containerRef.current.offsetTop
    scrollPositionRef.current = scrollTop

    const startRow = Math.floor(scrollTop / ITEM_HEIGHT)
    const visibleRowCount = Math.ceil(containerHeight / ITEM_HEIGHT)
    const endRow = startRow + visibleRowCount

    setVisibleRange({startRow, endRow})
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

  // Debounced scroll handler with RAF
  useEffect(() => {
    let timeoutId: number
    let rafId: number

    const debouncedScroll = () => {
      clearTimeout(timeoutId)
      cancelAnimationFrame(rafId)

      rafId = requestAnimationFrame(() => {
        timeoutId = window.setTimeout(handleScroll, SCROLL_DEBOUNCE)
      })
    }

    window.addEventListener("scroll", debouncedScroll, {passive: true})

    // Only call handleScroll on mount if we don't have a saved position
    if (savedScrollPosition === 0) {
      handleScroll()
    }

    return () => {
      clearTimeout(timeoutId)
      cancelAnimationFrame(rafId)
      window.removeEventListener("scroll", debouncedScroll)
    }
  }, [handleScroll, savedScrollPosition])

  // Update container height on resize
  useEffect(() => {
    const updateHeight = () => {
      setContainerHeight(window.innerHeight)
    }

    window.addEventListener("resize", updateHeight, {passive: true})
    return () => window.removeEventListener("resize", updateHeight)
  }, [])

  // Restore scroll position on mount - optimized
  useEffect(() => {
    if (isInitialMount.current && savedScrollPosition > 0 && containerRef.current) {
      isInitialMount.current = false
      // Immediate scroll restoration without RAF for instant positioning
      window.scrollTo(0, containerRef.current.offsetTop + savedScrollPosition)
    }
  }, [savedScrollPosition])

  // Handle new events shown
  useEffect(() => {
    if (eventsToHighlight && eventsToHighlight.size > 0) {
      setSavedScrollPosition(0)
      window.scrollTo(0, 0)
      onNewEventsShown?.()
    }
  }, [eventsToHighlight, onNewEventsShown, setSavedScrollPosition])

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

      <div
        ref={containerRef}
        style={{
          paddingTop: visibleItems.startOffset,
          paddingBottom: visibleItems.endOffset,
          minHeight: totalRows * ITEM_HEIGHT,
        }}
      >
        <div className="grid grid-cols-3 gap-[1px]">
          {visibleItems.items.map(({event, index}) => (
            <MemoizedGridItem
              key={event.id}
              event={event}
              index={index}
              setActiveItemIndex={handleImageClick}
              onEventFetched={handleEventFetched}
              highlightAsNew={eventsToHighlight?.has(event.id) || false}
            />
          ))}
        </div>
      </div>
    </>
  )
}

export default memo(VirtualizedMediaFeed)
