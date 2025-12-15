import {useState, useEffect, useRef} from "react"
import FeedItem from "../event/FeedItem/FeedItem"
import {NDKEvent} from "@/lib/ndk"
import {EmbedEvent} from "../embed/index"
import ProxyImg from "../ProxyImg"
import {generateVideoProxyUrl} from "@/shared/utils/imgproxy"
import Icon from "../Icons/Icon"
import Modal from "../ui/Modal"
import {SwipableCarousel} from "../ui/SwipableCarousel"
import {SwipeItem} from "@/shared/hooks/useSwipable"
import {RiArrowLeftSLine, RiArrowRightSLine} from "@remixicon/react"
import {useMediaModalSidebarVisible, useUIStore} from "@/stores/ui"
import {useSettingsStore} from "@/stores/settings"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

interface MediaModalProps {
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  mediaUrl?: string
  mediaType?: "image" | "video"
  media?: SwipeItem[]
  showFeedItem?: boolean
  event?: EmbedEvent
  currentIndex?: number
}

function isNDKEvent(event: EmbedEvent): event is NDKEvent {
  return event && typeof (event as NDKEvent).rawEvent !== "undefined"
}

function MediaModal({
  onClose,
  onPrev,
  onNext,
  mediaUrl,
  mediaType,
  media,
  showFeedItem,
  event,
  currentIndex: propCurrentIndex,
}: MediaModalProps) {
  // Use full media array if provided, otherwise create single item array
  const mediaItems =
    media ||
    (mediaUrl && mediaType
      ? [
          {
            id: mediaUrl,
            url: mediaUrl,
            type: mediaType,
            event,
          },
        ]
      : [])

  const initialIndex = propCurrentIndex ?? 0
  const [currentModalIndex, setCurrentModalIndex] = useState(initialIndex)
  const isEventBarVisible = useMediaModalSidebarVisible()
  const setMediaModalSidebarVisible = useUIStore(
    (state) => state.setMediaModalSidebarVisible
  )
  const {imgproxy} = useSettingsStore()

  // Get the current event from the media array or fallback to the prop
  const currentEvent = (mediaItems[currentModalIndex]?.event as EmbedEvent) || event
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())

  // Effect to handle video play/pause based on current index
  useEffect(() => {
    const videoMap = videoRefs.current

    // Stop all videos first
    videoMap.forEach((video) => {
      video.pause()
    })

    // Play only the current video if it exists
    const currentItem = mediaItems[currentModalIndex]
    if (currentItem?.type === "video") {
      const currentVideo = videoMap.get(currentItem.url)
      if (currentVideo) {
        currentVideo.play().catch(console.error)
      }
    }
  }, [currentModalIndex, mediaItems])

  const renderMediaItem = (
    item: SwipeItem,
    _index: number,
    wasDragged: {current: boolean}
  ) => {
    const handleImageClick = () => {
      // Don't close modal if this was a drag
      if (wasDragged.current) return
      if (!showFeedItem) onClose()
    }

    return item.type === "video" ? (
      <video
        ref={(el) => {
          if (el) {
            videoRefs.current.set(item.url, el)
          } else {
            videoRefs.current.delete(item.url)
          }
        }}
        loop
        autoPlay={false}
        src={item.url}
        controls
        className="max-w-full max-h-full"
        poster={generateVideoProxyUrl(item.url, {
          url: imgproxy.vidproxyUrl,
          key: imgproxy.key,
          salt: imgproxy.salt,
        })}
      />
    ) : (
      <ProxyImg
        src={item.url}
        className="max-w-full max-h-full object-contain"
        onClick={handleImageClick}
        key={item.url}
      />
    )
  }

  return (
    <Modal hasBackground={false} onClose={onClose}>
      <div className="relative flex w-screen h-screen">
        <div className="flex-1 relative bg-base-200/90 select-none">
          <button
            className="btn btn-circle btn-ghost absolute left-2 top-2 focus:outline-none text-white z-10"
            onClick={onClose}
          >
            <Icon name="close" size={12} />
          </button>

          {showFeedItem && currentEvent && (
            <button
              className="btn btn-circle btn-ghost absolute right-2 top-2 focus:outline-none text-white z-10"
              onClick={() => setMediaModalSidebarVisible(!isEventBarVisible)}
              title={isEventBarVisible ? "Hide event details" : "Show event details"}
            >
              {isEventBarVisible ? (
                <RiArrowRightSLine className="w-5 h-5" />
              ) : (
                <RiArrowLeftSLine className="w-5 h-5" />
              )}
            </button>
          )}

          <div
            className="absolute inset-0 flex items-center justify-center"
            onClick={(e) => {
              log("MediaModal Clicked:", e.target === e.currentTarget)
              if (e.target === e.currentTarget) {
                onClose()
              }
            }}
          >
            {mediaItems.length > 0 && (
              <SwipableCarousel
                items={mediaItems}
                renderItem={renderMediaItem}
                initialIndex={initialIndex}
                className="w-full h-full"
                enableKeyboardNav={true}
                onClose={onClose}
                showArrows={mediaItems.length > 1}
                onBackgroundClick={onClose}
                onIndexChange={(index) => {
                  setCurrentModalIndex(index)
                  // Call legacy callbacks if provided for backwards compatibility
                  if (index > currentModalIndex) {
                    onNext?.()
                  } else if (index < currentModalIndex) {
                    onPrev?.()
                  }
                }}
              />
            )}
          </div>

          {mediaItems.length > 1 && (
            <div className="absolute bottom-2 left-2 text-white bg-black bg-opacity-50 px-2 py-1 rounded z-10 flex items-center">
              {currentModalIndex + 1} / {mediaItems.length}
            </div>
          )}
        </div>

        {showFeedItem && currentEvent && isEventBarVisible && (
          <div className="w-[400px] bg-base-100 border-l flex-shrink-0 overflow-y-auto">
            <FeedItem
              key={isNDKEvent(currentEvent) ? currentEvent.id : undefined}
              event={isNDKEvent(currentEvent) ? currentEvent : undefined}
              asReply={false}
              showRepliedTo={true}
              showReplies={Infinity}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}

export default MediaModal
