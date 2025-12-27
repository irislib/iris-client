import {useState, MouseEvent, useMemo} from "react"
import {useSettingsStore} from "@/stores/settings"
import MediaModal from "../../media/MediaModal"
import ProxyImg from "../../ProxyImg"
import classNames from "classnames"
import {EmbedEvent} from "../index"
import {getAllEventMedia} from "./mediaUtils"

interface SmallImageComponentProps {
  match: string
  event: EmbedEvent | undefined
  size?: number
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

  // Current URLs from the match
  const urls = match.trim().split(/\s+/)

  // Get all media from the event
  const allEventMedia = useMemo(() => {
    const eventMedia = getAllEventMedia(event)

    // If no media found in event but we have URLs from the match, create media items
    if (eventMedia.length === 0 && urls.length > 0) {
      return urls.map((url) => ({
        url,
        type: url.match(/\.(mp4|webm|ogg|mov|m3u8)(?:\?|#|$)/i)
          ? ("video" as const)
          : ("image" as const),
      }))
    }

    return eventMedia
  }, [event, urls])

  // Find the index of the first URL from the match in all media
  const initialIndex = useMemo(() => {
    if (urls.length > 0) {
      return allEventMedia.findIndex((item) => item.url === urls[0])
    }
    return 0
  }, [allEventMedia, urls])

  const onClick = (event: MouseEvent) => {
    event.stopPropagation()
    if (isBlurred) {
      setIsBlurred(false)
    } else {
      setShowModal(true)
      setCurrentImageIndex(initialIndex >= 0 ? initialIndex : 0)
    }
  }

  return (
    <>
      <div className="flex flex-wrap justify-start items-center gap-2">
        {urls.map((url, index) => (
          <div key={index} className="flex justify-start items-center">
            {hasError ? (
              <div className="my-2 text-sm break-all select-all cursor-text">{url}</div>
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
      {showModal && allEventMedia.length > 0 && (
        <MediaModal
          onClose={() => setShowModal(false)}
          media={allEventMedia}
          currentIndex={currentImageIndex}
          showFeedItem={false}
          event={event}
        />
      )}
    </>
  )
}

export default SmallImageComponent
