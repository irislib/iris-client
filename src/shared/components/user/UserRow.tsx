import {ReactNode} from "react"

import {useHoverCard} from "@/shared/components/user/useHoverCard"
import {Avatar} from "@/shared/components/user/Avatar"
import {Name} from "@/shared/components/user/Name"
import ProfileCard from "./ProfileCard"
import {ProfileLink} from "./ProfileLink"

export function UserRow({
  pubKey,
  description,
  avatarWidth = 45,
  textClassName,
  linkToProfile = true,
  showBadge = true,
  showHoverCard = false,
  showAvatar = true,
}: {
  pubKey: string
  description?: ReactNode
  avatarWidth?: number
  textClassName?: string
  linkToProfile?: boolean
  showBadge?: boolean
  showHoverCard?: boolean
  showAvatar?: boolean
}) {
  const {hoverProps, showCard, cardRef} = useHoverCard(showHoverCard)

  const mainContent = (
    <div className="flex flex-row items-center gap-2 justify-between">
      <div className="flex items-center gap-2 flex-row break-words [overflow-wrap:anywhere]">
        {showAvatar && (
          <Avatar
            pubKey={pubKey}
            showTooltip={false}
            showBadge={showBadge}
            width={avatarWidth}
          />
        )}
        <Name pubKey={pubKey} className={textClassName} />
      </div>
      <span className="text-base-content">{description}</span>
    </div>
  )

  return (
    <div className="relative" data-testid="sidebar-user-row" {...hoverProps}>
      {linkToProfile ? (
        <ProfileLink pubKey={pubKey}>{mainContent}</ProfileLink>
      ) : (
        mainContent
      )}
      <div
        ref={cardRef}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        className={`cursor-default z-40 bg-base-100 rounded-2xl absolute left-0 top-full mt-2 w-96 min-h-32 p-4 transition-all duration-300 ease-in-out ${
          showCard ? "opacity-100" : "opacity-0 hidden"
        }`}
      >
        {showCard && (
          <ProfileCard pubKey={pubKey} showFollows={true} showHoverCard={false} />
        )}
      </div>
    </div>
  )
}
