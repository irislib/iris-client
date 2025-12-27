import {useState, useCallback} from "react"
import classNames from "classnames"

import MediaModal from "@/shared/components/media/MediaModal"
import {SwipableCarousel} from "@/shared/components/ui/SwipableCarousel"
import {useSettingsStore} from "@/stores/settings"
import {SwipeItem} from "@/shared/hooks/useSwipable"
import ImageComponent from "./ImageComponent"
import VideoComponent from "./VideoComponent"
import {EmbedEvent} from "../index"

interface MediaItem {
  url: string
  type: "image" | "video"
  imeta?: string[]
}

interface CarouselProps {
  media: MediaItem[]
  event?: EmbedEvent
}

function Carousel({media, event}: CarouselProps) {
  const {content} = useSettingsStore()

  const ImageIndicators = ({
    images,
    currentIndex,
  }: {
    images: MediaItem[]
    currentIndex: number
  }) => {
    const MAX_INDICATORS = 10
    const totalImages = images.length

    if (totalImages <= MAX_INDICATORS) {
      return (
        <div className="flex space-x-2 mt-2">
          {images.map((_, index) => (
            <span
              key={index}
              className={`h-2 w-2 rounded-full ${index === currentIndex ? "bg-primary" : "bg-gray-300"}`}
            />
          ))}
        </div>
      )
    }

    // Calculate the window of indicators to show
    const windowSize = MAX_INDICATORS - 2 // Reserve 2 spots for ellipsis
    const halfWindow = Math.floor(windowSize / 2)
    let startIndex = currentIndex - halfWindow
    let endIndex = currentIndex + halfWindow

    // Adjust window if near the start or end
    if (startIndex < 0) {
      startIndex = 0
      endIndex = windowSize
    } else if (endIndex >= totalImages) {
      endIndex = totalImages - 1
      startIndex = endIndex - windowSize
    }

    return (
      <div className="flex items-center space-x-2 mt-2">
        {startIndex > 0 && (
          <>
            <span className="h-2 w-2 rounded-full bg-gray-300" />
            <span className="text-gray-400">...</span>
          </>
        )}
        {Array.from({length: endIndex - startIndex + 1}).map((_, i) => {
          const index = startIndex + i
          return (
            <span
              key={index}
              className={`h-2 w-2 rounded-full ${
                index === currentIndex ? "bg-primary" : "bg-gray-300"
              }`}
            />
          )
        })}
        {endIndex < totalImages - 1 && (
          <>
            <span className="text-gray-400">...</span>
            <span className="h-2 w-2 rounded-full bg-gray-300" />
          </>
        )}
        <span className="text-sm text-gray-500 ml-2">
          {currentIndex + 1} / {totalImages}
        </span>
      </div>
    )
  }

  const [currentIndex, setCurrentIndex] = useState(0)

  // Convert media to SwipeItem format
  const swipeItems: SwipeItem[] = media.map((item) => ({
    url: item.url,
    type: item.type,
    imeta: item.imeta,
  }))

  const [blur, setBlur] = useState(
    content.blurNSFW &&
      (!!event?.content.toLowerCase().includes("#nsfw") ||
        event?.tags.some((t) => t[0] === "content-warning"))
  )
  const [showModal, setShowModal] = useState(false)
  const [isMuted, setIsMuted] = useState(content.autoplayVideos)

  const onCloseModal = useCallback(() => {
    setShowModal(false)
  }, [])

  const limitHeight = media.length > 1

  const renderMediaComponent = (
    item: SwipeItem,
    _index: number,
    wasDragged: {current: boolean}
  ) => {
    const onClickImage = () => {
      // Don't open modal if this was a drag
      if (wasDragged.current) return

      if (blur) {
        setBlur(false)
      } else {
        setShowModal(true)
      }
    }

    if (item.type === "image") {
      return (
        <ImageComponent
          match={item.url}
          onClickImage={onClickImage}
          blur={blur}
          key={item.url}
          limitHeight={limitHeight}
          imeta={item.imeta}
        />
      )
    }

    return (
      <VideoComponent
        match={item.url}
        event={event as EmbedEvent}
        key={item.url}
        blur={blur}
        onClick={() => setBlur(false)}
        limitHeight={limitHeight}
        imeta={item.imeta}
        isMuted={isMuted}
        onMuteChange={setIsMuted}
      />
    )
  }

  return (
    <div className="w-full my-2 flex flex-col items-center gap-2">
      <SwipableCarousel
        items={swipeItems}
        renderItem={renderMediaComponent}
        initialIndex={currentIndex}
        onIndexChange={setCurrentIndex}
        className={classNames("w-full", {
          "h-[600px]": limitHeight,
        })}
        showArrows={media.length > 1}
        arrowClassName="bg-gray-800 rounded-full opacity-50 text-white p-2"
      />
      {media.length > 1 && <ImageIndicators images={media} currentIndex={currentIndex} />}
      {showModal && (
        <MediaModal
          onClose={onCloseModal}
          media={swipeItems}
          currentIndex={currentIndex}
        />
      )}
    </div>
  )
}

export default Carousel
