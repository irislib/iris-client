import {useSettingsStore} from "@/stores/settings"
import {RiVideoLine} from "@remixicon/react"
import {useState, MouseEvent, useMemo} from "react"
import ProxyImg from "../../ProxyImg"
import classNames from "classnames"
import {EmbedEvent} from "../index"
import {generateBlurhashUrl, calculateDimensions, getAllEventMedia} from "./mediaUtils"
import MediaModal from "../../media/MediaModal"
import {getImetaDataForUrl} from "@/shared/utils/imetaUtils"

interface SmallThumbnailComponentProps {
  match: string
  event: EmbedEvent | undefined
}

function SmallThumbnailComponent({match, event}: SmallThumbnailComponentProps) {
  const {content} = useSettingsStore()
  const [isBlurred, setIsBlurred] = useState(
    content.blurNSFW &&
      (!!event?.content.toLowerCase().includes("#nsfw") ||
        event?.tags.some((t) => t[0] === "content-warning"))
  )
  const [error, setError] = useState(false)
  const [showModal, setShowModal] = useState(false)

  // Extract imeta data for this URL using utility
  const imetaData = useMemo(() => {
    if (!event) return undefined
    return getImetaDataForUrl(event, match)
  }, [event, match])

  const originalWidth = imetaData?.width || null
  const originalHeight = imetaData?.height || null
  const blurhash = imetaData?.blurhash

  // Extract alt text from imeta name field and truncate it
  const altText = useMemo(() => {
    const name = imetaData?.name || imetaData?.alt
    if (!name) return "thumbnail"
    return name.length > 30 ? name.substring(0, 30) + "..." : name
  }, [imetaData])

  // Generate blurhash URL for placeholder (use original dimensions for better aspect ratio)
  const blurhashDimensions =
    originalWidth && originalHeight
      ? calculateDimensions(originalWidth, originalHeight, true)
      : undefined

  const blurhashUrl = useMemo(
    () => generateBlurhashUrl(blurhash, blurhashDimensions),
    [blurhash, blurhashDimensions]
  )

  // Get all media from the event
  const allEventMedia = useMemo(() => getAllEventMedia(event), [event])

  // Find the index of the current video in all media
  const currentIndex = useMemo(() => {
    return allEventMedia.findIndex((item) => item.url === match)
  }, [allEventMedia, match])

  const onClick = (e: MouseEvent) => {
    e.stopPropagation()
    if (isBlurred) {
      setIsBlurred(false)
    } else {
      setShowModal(true)
    }
  }

  // Fixed square dimensions
  const containerStyle = {
    width: "96px", // 24 * 4 = w-24
    height: "96px", // 24 * 4 = h-24
  }

  return (
    <div className="my-2">
      {error ? (
        <div
          className="rounded bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-neutral-500 dark:text-neutral-400 cursor-pointer"
          style={containerStyle}
          onClick={onClick}
        >
          {blurhashUrl ? (
            <div
              className="w-full h-full rounded flex items-center justify-center"
              style={{
                backgroundImage: `url(${blurhashUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              <RiVideoLine className="w-6 h-6 opacity-70" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-2">
              <RiVideoLine className="w-6 h-6 opacity-70 mb-1" />
              {altText !== "thumbnail" && (
                <span className="text-xs text-center leading-tight opacity-60">
                  {altText}
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div
          className="relative cursor-pointer"
          style={{
            width: "96px",
            height: "96px",
          }}
        >
          <ProxyImg
            square={true}
            onClick={onClick}
            onError={() => setError(true)}
            hideBroken={true}
            loadOriginalIfProxyFails={false}
            className={classNames("rounded object-cover", {"blur-xl": isBlurred})}
            style={{
              width: "96px",
              height: "96px",
              backgroundImage: blurhashUrl ? `url(${blurhashUrl})` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
            src={match}
            width={96}
            alt={altText}
            isVideo={true}
          />
          {/* Fallback placeholder in case ProxyImg renders nothing */}
          {!error && (
            <div
              className="absolute inset-0 rounded bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-neutral-500 dark:text-neutral-400"
              style={{
                zIndex: -1,
              }}
            >
              {blurhashUrl ? (
                <div
                  className="w-full h-full rounded flex items-center justify-center"
                  style={{
                    backgroundImage: `url(${blurhashUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                >
                  <RiVideoLine className="w-6 h-6 opacity-70" />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-2">
                  <RiVideoLine className="w-6 h-6 opacity-70 mb-1" />
                  {altText !== "thumbnail" && (
                    <span className="text-xs text-center leading-tight opacity-60">
                      {altText}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {showModal && allEventMedia.length > 0 && (
        <MediaModal
          onClose={() => setShowModal(false)}
          media={allEventMedia}
          currentIndex={currentIndex >= 0 ? currentIndex : 0}
          showFeedItem={false}
          event={event}
        />
      )}
    </div>
  )
}

export default SmallThumbnailComponent
