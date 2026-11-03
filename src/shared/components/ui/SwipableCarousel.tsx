import {
  useEffect,
  ReactNode,
  CSSProperties,
  TouchEvent as ReactTouchEvent,
  MouseEvent as ReactMouseEvent,
} from "react"
import {RiArrowLeftSLine, RiArrowRightSLine} from "@remixicon/react"
import {SwipeItem, useSwipable} from "@/shared/hooks/useSwipable"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

interface SwipableCarouselProps {
  items: SwipeItem[]
  renderItem: (
    item: SwipeItem,
    index: number,
    wasDragged: {current: boolean}
  ) => ReactNode
  initialIndex?: number
  threshold?: number
  onIndexChange?: (index: number) => void
  className?: string
  adaptiveHeight?: boolean
  style?: CSSProperties
  onWasDraggedRef?: (ref: {current: boolean}) => void
  enableKeyboardNav?: boolean
  onClose?: () => void
  showArrows?: boolean
  arrowClassName?: string
  onBackgroundClick?: () => void
}

export function SwipableCarousel({
  items,
  renderItem,
  initialIndex = 0,
  threshold = 0.5,
  onIndexChange,
  className = "",
  adaptiveHeight = false,
  style,
  enableKeyboardNav = false,
  onClose,
  showArrows = false,
  arrowClassName = "btn btn-circle btn-ghost text-white",
  onBackgroundClick,
}: SwipableCarouselProps) {
  const {
    currentIndex,
    isDragging,
    isTransitioning,
    containerRef,
    wasDragged,
    handlers,
    navigation,
    getTransform,
    cleanup,
  } = useSwipable({
    items,
    initialIndex,
    threshold,
    onIndexChange,
  })

  // Media preloading - preload adjacent images and videos for smoother navigation
  useEffect(() => {
    if (items.length <= 1) return

    const preloadImage = (url: string) => {
      const img = new Image()
      img.src = url
    }

    const preloadVideo = (url: string) => {
      const video = document.createElement("video")
      video.preload = "metadata"
      video.src = url
    }

    // Preload previous and next media
    const prevIndex = navigation.getPrevIndex()
    const nextIndex = navigation.getNextIndex()

    const prevItem = items[prevIndex]
    const nextItem = items[nextIndex]

    if (prevItem?.type === "image") {
      preloadImage(prevItem.url)
    } else if (prevItem?.type === "video") {
      preloadVideo(prevItem.url)
    }

    if (nextItem?.type === "image") {
      preloadImage(nextItem.url)
    } else if (nextItem?.type === "video") {
      preloadVideo(nextItem.url)
    }
  }, [currentIndex, items, navigation])

  // Keyboard navigation
  useEffect(() => {
    if (!enableKeyboardNav) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault()
        navigation.goToNext()
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        navigation.goToPrev()
      } else if (e.key === "Escape" && onClose) {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [enableKeyboardNav, navigation, onClose])

  // Set up non-passive touch event listeners
  useEffect(() => {
    const element = containerRef.current
    if (!element || items.length <= 1) return

    const handleTouchStart = (e: TouchEvent) => {
      handlers.onDragStart(e as unknown as ReactTouchEvent | ReactMouseEvent)
    }

    const handleTouchMove = (e: TouchEvent) => {
      // Let the drag handler decide whether to prevent default based on scroll direction
      handlers.onDragMove(e as unknown as ReactTouchEvent | ReactMouseEvent)
    }

    const handleTouchEnd = () => {
      handlers.onDragEnd()
    }

    // Add non-passive event listeners
    element.addEventListener("touchstart", handleTouchStart, {passive: false})
    element.addEventListener("touchmove", handleTouchMove, {passive: false})
    element.addEventListener("touchend", handleTouchEnd, {passive: false})

    return () => {
      element.removeEventListener("touchstart", handleTouchStart)
      element.removeEventListener("touchmove", handleTouchMove)
      element.removeEventListener("touchend", handleTouchEnd)
      cleanup()
    }
  }, [items.length, handlers, cleanup])

  if (items.length === 0) return null

  const renderCarouselItems = () => {
    if (items.length === 1) {
      return (
        <div className="w-full flex justify-center items-center">
          {renderItem(items[0], 0, wasDragged)}
        </div>
      )
    }

    const prev = items[navigation.getPrevIndex()]
    const curr = items[currentIndex]
    const next = items[navigation.getNextIndex()]

    // In feeds, only the active slide determines height. Adjacent slides remain
    // centered for swiping without reserving space for a taller hidden image.
    return (
      <>
        <div
          key={prev.url === next.url ? `${prev.url}-prev` : prev.url}
          className={`w-full flex-shrink-0 flex justify-center items-center ${adaptiveHeight ? "h-0 self-center" : ""}`}
        >
          {renderItem(prev, navigation.getPrevIndex(), wasDragged)}
        </div>
        <div
          key={curr.url}
          className="w-full flex-shrink-0 flex justify-center items-center"
        >
          {renderItem(curr, currentIndex, wasDragged)}
        </div>
        <div
          key={next.url}
          className={`w-full flex-shrink-0 flex justify-center items-center ${adaptiveHeight ? "h-0 self-center" : ""}`}
        >
          {renderItem(next, navigation.getNextIndex(), wasDragged)}
        </div>
      </>
    )
  }

  return (
    <div
      role="group"
      aria-label="Media carousel"
      className={`relative overflow-hidden ${className}`}
      style={{touchAction: items.length > 1 ? "pan-y pinch-zoom" : "auto", ...style}}
    >
      <div
        ref={containerRef}
        className="flex w-full h-full select-none"
        style={{
          transform: items.length > 1 ? getTransform() : "translateX(0)",
          transition: isDragging
            ? "none"
            : "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
          willChange: "transform",
          cursor: (() => {
            if (items.length <= 1) return "default"
            return isDragging ? "grabbing" : "grab"
          })(),
          pointerEvents: isTransitioning ? "none" : "auto",
        }}
        onMouseDown={items.length > 1 ? handlers.onDragStart : undefined}
        onMouseMove={isDragging ? handlers.onDragMove : undefined}
        onMouseUp={handlers.onDragEnd}
        onMouseLeave={isDragging ? handlers.onDragEnd : undefined}
        onTransitionEnd={handlers.onTransitionEnd}
        onClick={(e) => {
          log("SwipableCarousel clicked:", {
            wasDragged: wasDragged.current,
            isCurrentTarget: e.target === e.currentTarget,
            target: e.target,
            currentTarget: e.currentTarget,
            hasCallback: !!onBackgroundClick,
          })
          // Handle background clicks (outside media content)
          // Check if click is on carousel container or on the media item containers (but not the actual media)
          const isCarouselContainer = e.target === e.currentTarget
          const isMediaItemContainer = (e.target as HTMLElement).classList?.contains(
            "justify-center"
          )

          if (
            !wasDragged.current &&
            (isCarouselContainer || isMediaItemContainer) &&
            onBackgroundClick
          ) {
            log("Calling onBackgroundClick")
            onBackgroundClick()
          }
        }}
      >
        {renderCarouselItems()}
      </div>

      {showArrows && items.length > 1 && (
        <>
          <div className="absolute top-1/2 -translate-y-1/2 left-4 z-10">
            <button
              aria-label="Previous media"
              onClick={(e) => {
                e.stopPropagation()
                navigation.goToPrev()
              }}
              className={arrowClassName}
            >
              <RiArrowLeftSLine size={24} />
            </button>
          </div>
          <div className="absolute top-1/2 -translate-y-1/2 right-4 z-10">
            <button
              aria-label="Next media"
              onClick={(e) => {
                e.stopPropagation()
                navigation.goToNext()
              }}
              className={arrowClassName}
            >
              <RiArrowRightSLine size={24} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
