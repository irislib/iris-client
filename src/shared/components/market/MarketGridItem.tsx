import {extractMarketData} from "@/shared/utils/marketUtils"
import {RiImageLine} from "@remixicon/react"
import {NostrEvent, nip19} from "nostr-tools"
import ProxyImg from "../ProxyImg"
import {Link} from "react-router"

type MarketGridItemProps = {
  event: NostrEvent
  shouldBlur?: boolean
  width?: number
}

/**
 * A reusable component for displaying market listings in a grid
 */
const MarketGridItem = ({
  event,
  shouldBlur = false,
  width = 150,
}: MarketGridItemProps) => {
  const {title, price, imageUrl} = extractMarketData(event)

  return (
    <Link
      to={`/${nip19.noteEncode(event.id)}`}
      className={`aspect-square cursor-pointer relative bg-neutral-300 hover:opacity-80 block ${shouldBlur ? "blur-xl" : ""}`}
    >
      {(price || title) && (
        <div className="absolute top-0 left-0 right-0 p-4 pb-8 bg-gradient-to-b from-black/85 via-black/65 via-black/45 to-transparent text-white z-10">
          {price && <div className="text-lg font-bold drop-shadow-sm">{price}</div>}
          {title && <div className="text-sm truncate drop-shadow-sm">{title}</div>}
        </div>
      )}
      {imageUrl ? (
        <ProxyImg
          square={true}
          width={width}
          src={imageUrl}
          alt=""
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-base-200">
          <div className="text-base-content/50 text-center p-4">
            <RiImageLine className="w-8 h-8 mx-auto" />
          </div>
        </div>
      )}
    </Link>
  )
}

export default MarketGridItem
