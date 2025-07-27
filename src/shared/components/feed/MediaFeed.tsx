import InfiniteScroll from "@/shared/components/ui/InfiniteScroll"
import {IMAGE_REGEX, VIDEO_REGEX} from "../embed/media/MediaEmbed"
import {INITIAL_DISPLAY_COUNT, DISPLAY_INCREMENT} from "./utils"
import {useState, useMemo, useCallback, useEffect, useRef} from "react"
import useHistoryState from "@/shared/hooks/useHistoryState"
import PreloadImages from "../media/PreloadImages"
import MediaModal from "../media/MediaModal"
import {NostrEvent} from "nostr-tools"
import ImageGridItem from "./ImageGridItem"
import DebugManager from "@/utils/DebugManager"

interface MediaFeedProps {
  events: (NostrEvent | {id: string})[]
}

// Limit memory usage by keeping only recent events
const MAX_FETCHED_EVENTS = 100
const PRELOAD_RANGE = 3 // Only preload 3 images before/after current

export default function MediaFeed({events}: MediaFeedProps) {
  const [showModal, setShowModal] = useState(false)
  const [activeItemIndex, setActiveItemIndex] = useState<number | null>(null)
  const [displayCount, setDisplayCount] = useHistoryState(
    INITIAL_DISPLAY_COUNT,
    "displayCount"
  )
  const [modalMedia, setModalMedia] = useState<
    Array<{type: "image" | "video"; url: string; event: NostrEvent}>
  >([])

  // Use a Map for better performance and automatic deduplication
  const [fetchedEventsMap, setFetchedEventsMap] = useState<Map<string, NostrEvent>>(
    new Map()
  )

  // Debug tracking
  const renderCount = useRef(0)
  const lastDebugTime = useRef(0)
  const debugManager = DebugManager

  // Debug: Track renders and send periodic debug info
  useEffect(() => {
    renderCount.current++
    const now = Date.now()

    // Send debug info every 5 seconds to avoid spam
    if (now - lastDebugTime.current > 5000) {
      lastDebugTime.current = now

      if (debugManager.isDebugEnabled()) {
        const debugSession = debugManager.getDebugSession()
        if (debugSession) {
          const memoryEstimate = calculateMemoryEstimate()
          debugSession.publish("mediaFeed_debug", {
            timestamp: now,
            renderCount: renderCount.current,
            eventsTotal: events.length,
            eventsVisible: displayCount,
            fetchedEventsMapSize: fetchedEventsMap.size,
            modalMediaLength: modalMedia.length,
            showModal,
            activeItemIndex,
            memoryEstimate,
            userAgent: navigator.userAgent,
          })
        }
      }
    }
  })

  // Debug: Calculate rough memory estimate
  const calculateMemoryEstimate = useCallback(() => {
    let estimate = 0

    // Estimate fetchedEventsMap memory (rough calculation)
    for (const [id, event] of fetchedEventsMap) {
      estimate += id.length * 2 // string chars are 2 bytes
      estimate += (event.content?.length || 0) * 2
      estimate += JSON.stringify(event.tags || []).length * 2
      estimate += 200 // overhead for object structure
    }

    // Estimate modalMedia memory
    estimate += modalMedia.length * (100 + 200) // url + object overhead

    // Convert to KB
    return Math.round(estimate / 1024)
  }, [fetchedEventsMap, modalMedia])

  const visibleEvents = useMemo(() => {
    return events.slice(0, displayCount)
  }, [events, displayCount])

  const calculateAllMedia = useCallback(
    (events: NostrEvent[]) => {
      const startTime = performance.now()

      const deduplicated = new Map<
        string,
        {type: "image" | "video"; url: string; event: NostrEvent}
      >()

      events.forEach((event) => {
        const imageMatches = event.content.match(IMAGE_REGEX) || []
        const videoMatches = event.content.match(VIDEO_REGEX) || []

        const imageUrls = imageMatches.flatMap((match) =>
          match
            .trim()
            .split(/\s+/)
            .map((url) => ({
              type: "image" as const,
              url,
              event,
            }))
        )

        const videoUrls = videoMatches.flatMap((match) =>
          match
            .trim()
            .split(/\s+/)
            .map((url) => ({
              type: "video" as const,
              url,
              event,
            }))
        )

        for (const item of [...imageUrls, ...videoUrls]) {
          const uniqueId = `${event.id}_${item.url}`
          if (!deduplicated.has(uniqueId)) {
            deduplicated.set(uniqueId, item)
          }
        }
      })

      const result = Array.from(deduplicated.values())
      const duration = performance.now() - startTime

      // Debug: Log expensive calculateAllMedia calls
      if (duration > 10 && debugManager.isDebugEnabled()) {
        const debugSession = debugManager.getDebugSession()
        if (debugSession) {
          debugSession.publish("mediaFeed_performance", {
            operation: "calculateAllMedia",
            duration: Math.round(duration),
            eventsProcessed: events.length,
            mediaItemsFound: result.length,
            timestamp: Date.now(),
          })
        }
      }

      return result
    },
    [debugManager]
  )

  const handlePrevItem = () => {
    if (activeItemIndex === null) return
    setActiveItemIndex(Math.max(0, activeItemIndex - 1))
  }

  const handleNextItem = () => {
    if (activeItemIndex === null) return
    setActiveItemIndex(Math.min(modalMedia.length - 1, activeItemIndex + 1))
  }

  useEffect(() => {
    if (!showModal) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        handlePrevItem()
      } else if (e.key === "ArrowRight") {
        handleNextItem()
      } else if (e.key === "Escape") {
        setShowModal(false)
        setActiveItemIndex(null)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [showModal, activeItemIndex])

  const loadMoreItems = () => {
    if (events.length > displayCount) {
      setDisplayCount((prev: number) => prev + DISPLAY_INCREMENT)
      return true
    }
    return false
  }

  const handleImageClick = (event: NostrEvent, clickedUrl: string) => {
    const startTime = performance.now()

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
        if ("content" in eventItem) {
          return eventItem
        }
        // Skip unfetched events for now (they'll be fetched on demand)
        return null
      })
      .filter(Boolean) as NostrEvent[]

    // Calculate media from all available events
    const mediaArray = calculateAllMedia(allEvents)
    const mediaIndex = mediaArray.findIndex(
      (media) => media.event.id === event.id && media.url === clickedUrl
    )

    if (mediaIndex === -1) {
      return
    }

    setModalMedia(mediaArray)
    setActiveItemIndex(mediaIndex)
    setShowModal(true)

    const duration = performance.now() - startTime

    // Debug: Log modal opening performance
    if (debugManager.isDebugEnabled()) {
      const debugSession = debugManager.getDebugSession()
      if (debugSession) {
        debugSession.publish("mediaFeed_performance", {
          operation: "handleImageClick",
          duration: Math.round(duration),
          allEventsCount: allEvents.length,
          mediaArrayLength: mediaArray.length,
          mediaIndex,
          timestamp: Date.now(),
        })
      }
    }
  }

  const handleEventFetched = useCallback(
    (event: NostrEvent) => {
      setFetchedEventsMap((prev) => {
        if (prev.has(event.id)) return prev

        const newMap = new Map(prev)
        newMap.set(event.id, event)

        // Limit memory usage by keeping only the most recent events
        if (newMap.size > MAX_FETCHED_EVENTS) {
          const entries = Array.from(newMap.entries())
          // Sort by event creation time and keep only the most recent
          entries.sort(([, a], [, b]) => (b.created_at || 0) - (a.created_at || 0))
          const limitedEntries = entries.slice(0, MAX_FETCHED_EVENTS)

          // Debug: Log when we're trimming events
          if (debugManager.isDebugEnabled()) {
            const debugSession = debugManager.getDebugSession()
            if (debugSession) {
              debugSession.publish("mediaFeed_memory", {
                operation: "trimFetchedEvents",
                oldSize: newMap.size,
                newSize: MAX_FETCHED_EVENTS,
                eventsRemoved: newMap.size - MAX_FETCHED_EVENTS,
                timestamp: Date.now(),
              })
            }
          }

          return new Map(limitedEntries)
        }

        return newMap
      })
    },
    [debugManager]
  )

  // Clean up events that are no longer visible
  useEffect(() => {
    const visibleEventIds = new Set(visibleEvents.map((e) => e.id))
    setFetchedEventsMap((prev) => {
      const newMap = new Map()
      let removedCount = 0

      for (const [id, event] of prev) {
        if (visibleEventIds.has(id)) {
          newMap.set(id, event)
        } else {
          removedCount++
        }
      }

      // Debug: Log cleanup activity
      if (removedCount > 0 && debugManager.isDebugEnabled()) {
        const debugSession = debugManager.getDebugSession()
        if (debugSession) {
          debugSession.publish("mediaFeed_memory", {
            operation: "cleanupInvisibleEvents",
            eventsRemoved: removedCount,
            remainingEvents: newMap.size,
            visibleEventsCount: visibleEvents.length,
            timestamp: Date.now(),
          })
        }
      }

      return newMap
    })
  }, [visibleEvents, debugManager])

  const isModalOpen = showModal
  const hasActiveItem = activeItemIndex !== null
  const hasModalMedia = modalMedia.length > 0
  const isValidIndex = activeItemIndex !== null && activeItemIndex < modalMedia.length
  const shouldShowModal = isModalOpen && hasActiveItem && hasModalMedia && isValidIndex

  // Calculate preload range for better memory management
  const preloadImages = useMemo(() => {
    if (!shouldShowModal || activeItemIndex === null) return []

    const start = Math.max(0, activeItemIndex - PRELOAD_RANGE)
    const end = Math.min(modalMedia.length, activeItemIndex + PRELOAD_RANGE + 1)

    return modalMedia.slice(start, end).map((m) => m.url)
  }, [shouldShowModal, activeItemIndex, modalMedia])

  // Calculate the current index within the preload range
  const currentPreloadIndex = useMemo(() => {
    if (!shouldShowModal || activeItemIndex === null) return 0

    const start = Math.max(0, activeItemIndex - PRELOAD_RANGE)
    return activeItemIndex - start
  }, [shouldShowModal, activeItemIndex])

  return (
    <>
      {shouldShowModal && (
        <>
          <MediaModal
            onClose={() => {
              setShowModal(false)
              setActiveItemIndex(null)
              setModalMedia([])
            }}
            onPrev={handlePrevItem}
            onNext={handleNextItem}
            mediaUrl={modalMedia[activeItemIndex].url}
            mediaType={modalMedia[activeItemIndex].type}
            showFeedItem={true}
            event={modalMedia[activeItemIndex].event}
            currentIndex={activeItemIndex}
            totalCount={modalMedia.length}
          />
          <PreloadImages images={preloadImages} currentIndex={currentPreloadIndex} />
        </>
      )}

      <InfiniteScroll onLoadMore={loadMoreItems}>
        <div className="grid grid-cols-3 gap-px md:gap-1">
          {visibleEvents.map((item, index) => (
            <ImageGridItem
              key={item.id}
              event={item}
              index={index}
              setActiveItemIndex={handleImageClick}
              onEventFetched={handleEventFetched}
            />
          ))}
        </div>
      </InfiniteScroll>
    </>
  )
}
