import {getMarketImageUrls} from "@/shared/utils/marketUtils"
import {useState, MouseEvent, useEffect} from "react"
import {useSettingsStore} from "@/stores/settings"
import MediaModal from "../../media/MediaModal"
import {NostrEvent} from "nostr-tools"
import ProxyImg from "../../ProxyImg"
import classNames from "classnames"
import {EmbedEvent} from "../index"

interface SmallImageComponentProps {
  match: string
  event: EmbedEvent | undefined
  size?: number
}

function isNostrEvent(event: EmbedEvent): event is NostrEvent {
  return event && typeof event === "object" && "pubkey" in event
}

function SmallImageComponent({match, event, size = 80}: SmallImageComponentProps) {
  const {content} = useSettingsStore()
  const [isBlurred, setIsBlurred] = useState(
    content.blurNSFW &&
      (!!event?.content.toLowerCase().includes("#nsfw") ||
        event?.tags.some((t) => t[0] === "content-warning"))
  )

  const [hasError, setHasError] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  const onClick = (event: MouseEvent) => {
    event.stopPropagation()
    if (isBlurred) {
      setIsBlurred(false)
    } else {
      setShowModal(true)
      setCurrentImageIndex(0)
    }
  }

  const urls = match.trim().split(/\s+/)

  // Get all image URLs from tags if it's a market listing
  const allImageUrls = event && isNostrEvent(event) ? getMarketImageUrls(event) : urls

  const handlePrev = () => {
    setCurrentImageIndex((prev) => (prev - 1 + allImageUrls.length) % allImageUrls.length)
  }

  const handleNext = () => {
    setCurrentImageIndex((prev) => (prev + 1) % allImageUrls.length)
  }

  useEffect(() => {
    if (!showModal) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        handleNext()
      } else if (e.key === "ArrowLeft") {
        handlePrev()
      } else if (e.key === "Escape") {
        setShowModal(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [showModal])

  return (
    <>
      <div className="flex flex-wrap justify-start items-center gap-2">
        {urls.map((url, index) => (
          <div key={index} className="flex justify-start items-center">
            {hasError ? (
              <div className="my-2 text-sm break-all">{url}</div>
            ) : (
              <ProxyImg
                square={true}
                width={size}
                onError={() => setHasError(true)}
                onClick={onClick}
                className={classNames(
                  "mt-2 rounded cursor-pointer aspect-square object-cover",
                  {
                    "blur-md": isBlurred,
                  }
                )}
                style={{width: size, height: size}}
                src={url}
              />
            )}
          </div>
        ))}
      </div>
      {showModal && (
        <MediaModal
          onClose={() => setShowModal(false)}
          mediaUrl={allImageUrls[currentImageIndex]}
          mediaType="image"
          showFeedItem={false}
          event={event}
          onPrev={allImageUrls.length > 1 ? handlePrev : undefined}
          onNext={allImageUrls.length > 1 ? handleNext : undefined}
          currentIndex={allImageUrls.length > 1 ? currentImageIndex : undefined}
          totalCount={allImageUrls.length > 1 ? allImageUrls.length : undefined}
        />
      )}
    </>
  )
}

export default SmallImageComponent
