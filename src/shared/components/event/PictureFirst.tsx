import {AppEvent} from "@/lib/nostr"
import {memo} from "react"
import Carousel from "../embed/media/Carousel"
import HyperText from "../HyperText"
import {extractImetaImages} from "@/shared/utils/imetaUtils"

interface PictureFirstProps {
  event: AppEvent
  truncate?: number
  standalone?: boolean
}

const PictureFirst = ({event, truncate = 0, standalone}: PictureFirstProps) => {
  // Extract images from imeta tags
  const images = extractImetaImages(event)

  // Get title from title tag if present
  const title = event.tagValue("title")

  return (
    <div className="w-full">
      {/* Show images first as carousel if multiple, single if one */}
      {images.length > 0 && <Carousel media={images} event={event} />}

      {/* Show title if present */}
      {title && (
        <div className="px-4 mb-2">
          <h3 className="text-lg font-semibold">{title}</h3>
        </div>
      )}

      {/* Show content if present */}
      {event.content && (
        <HyperText event={event} truncate={truncate} expandable={!standalone}>
          {event.content}
        </HyperText>
      )}
    </div>
  )
}

export default memo(PictureFirst)
