import {useEffect, useMemo, useState, ReactNode, CSSProperties} from "react"

import MinidenticonImg from "@/shared/components/user/MinidenticonImg"
import {ProfileHoverCard} from "@/shared/components/user/ProfileHoverCard"
import {useHoverCard} from "@/shared/components/user/useHoverCard"
import ProxyImg from "@/shared/components/ProxyImg.tsx"
import useProfile from "@/shared/hooks/useProfile.ts"
import {Badge} from "@/shared/components/user/Badge"
import {PublicKey} from "@/shared/utils/PublicKey"
import AnimalName from "@/utils/AnimalName.ts"
import {AVATAR_DEFAULT_WIDTH} from "./const"

export const Avatar = ({
  width = AVATAR_DEFAULT_WIDTH,
  pubKey,
  showBadge = true,
  showTooltip = true,
  showHoverCard = false,
  showOnlineIndicator = false,
  cornerBadge,
}: {
  width?: number
  pubKey: string
  showBadge?: boolean
  showTooltip?: boolean
  showHoverCard?: boolean
  showOnlineIndicator?: boolean
  cornerBadge?: {
    content: ReactNode
    position?: "top-right" | "bottom-right"
    className?: string
    style?: CSSProperties
    shape?: "circle" | "rounded"
  }
}) => {
  const pubKeyHex = useMemo(() => {
    if (!pubKey) {
      return ""
    }
    try {
      return new PublicKey(pubKey).toString()
    } catch (error) {
      console.error("Invalid public key:", pubKey, error)
      return ""
    }
  }, [pubKey])

  const profile = useProfile(pubKeyHex, true)
  const [image, setImage] = useState(String(profile?.picture || ""))

  useEffect(() => {
    setImage(profile?.picture ? String(profile.picture) : "")
  }, [profile])

  const handleImageError = () => {
    setImage("")
  }

  const {hoverProps, showCard, cardRef} = useHoverCard(showHoverCard)

  const getCornerBadgePosition = () => {
    const position = cornerBadge?.position || "bottom-right"
    switch (position) {
      case "top-right":
        return "absolute top-0 right-0 transform translate-x-1/4 -translate-y-1/4"
      case "bottom-right":
      default:
        return "absolute bottom-0 right-0 transform translate-x-1/4 translate-y-1/4"
    }
  }

  return (
    <div
      className={`aspect-square rounded-full bg-base-100 flex items-center justify-center select-none relative`}
      {...hoverProps}
      style={{width, height: width}}
    >
      {showBadge && (
        <Badge
          pubKeyHex={pubKeyHex}
          className="absolute top-0 right-0 transform translate-x-1/3 -translate-y-1/3"
        />
      )}
      <div
        className="w-full rounded-full overflow-hidden aspect-square not-prose"
        title={
          showTooltip
            ? String(
                profile?.name ||
                  profile?.display_name ||
                  profile?.username ||
                  profile?.nip05?.split("@")[0] ||
                  (pubKeyHex && AnimalName(pubKeyHex))
              )
            : ""
        }
      >
        {image ? (
          <ProxyImg
            width={width}
            square={true}
            src={image}
            alt=""
            className="w-full h-full object-cover"
            onError={handleImageError}
          />
        ) : (
          <MinidenticonImg username={pubKeyHex} alt="User Avatar" />
        )}
      </div>
      {cornerBadge && (
        <span
          className={`${getCornerBadgePosition()} bg-base-100 border border-base-300 leading-none flex items-center justify-center rounded-full ${
            cornerBadge.shape === "rounded" ? "px-1" : ""
          } ${cornerBadge.className || ""}`}
          style={{
            ...(cornerBadge.shape === "rounded"
              ? {minWidth: 16, height: 16, fontSize: 10}
              : {width: 16, height: 16, fontSize: 10}),
            ...cornerBadge.style,
          }}
        >
          {cornerBadge.content}
        </span>
      )}
      {showHoverCard && (
        <ProfileHoverCard pubKey={pubKey} showCard={showCard} cardRef={cardRef} />
      )}
    </div>
  )
}
