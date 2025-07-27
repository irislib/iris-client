import SmallImageComponent from "../embed/media/SmallImageComponent"
import {RiImageLine} from "@remixicon/react"
import {NostrEvent} from "nostr-tools"

type MarketImageProps = {
  event: NostrEvent
  imageUrl: string | null
  size?: number
  className?: string
}

/**
 * A reusable component for displaying market listing images
 */
const MarketImage = ({event, imageUrl, size = 160, className = ""}: MarketImageProps) => {
  return (
    <div className={`flex-shrink-0 ${className}`}>
      {imageUrl ? (
        <SmallImageComponent match={imageUrl} event={event} size={size} />
      ) : (
        <div
          className="bg-base-200 rounded flex items-center justify-center"
          style={{width: `${size}px`, height: `${size}px`}}
        >
          <RiImageLine className="w-8 h-8 text-base-content/50" />
        </div>
      )}
    </div>
  )
}

export default MarketImage
