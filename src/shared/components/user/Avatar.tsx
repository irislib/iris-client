import {useEffect, useMemo, useState} from "react"

import MinidenticonImg from "@/shared/components/user/MinidenticonImg"
import {useHoverCard} from "@/shared/components/user/useHoverCard"
import ProfileCard from "@/shared/components/user/ProfileCard"
import {profilePerformanceTest} from "@/utils/performanceTest"
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
}: {
  width?: number
  pubKey: string
  showBadge?: boolean
  showTooltip?: boolean
  showHoverCard?: boolean
}) => {
  useEffect(() => {
    profilePerformanceTest.trackComponentRender("Avatar")
  })
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

  const {hoverProps, showCard} = useHoverCard(showHoverCard)

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
      {showHoverCard && (
        <div
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          className={`cursor-default z-20 bg-base-100 rounded-2xl fixed md:absolute left-0 top-1/2 -translate-y-1/2 md:top-full md:translate-y-0 mt-2 w-full md:w-96 min-h-32 p-4 transition-all duration-300 ease-in-out ${
            showCard ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          {showCard && (
            <ProfileCard pubKey={pubKey} showFollows={true} showHoverCard={false} />
          )}
        </div>
      )}
    </div>
  )
}
