import socialGraph from "@/utils/socialGraph.ts"
import {RiCheckLine, RiVolumeMuteLine} from "@remixicon/react"
import {useUserStore} from "@/stores/user"

export const Badge = ({
  pubKeyHex,
  className,
}: {
  pubKeyHex: string
  className?: string
}) => {
  const publicKey = useUserStore((state) => state.publicKey)
  const loggedIn = !!publicKey

  if (!loggedIn || !pubKeyHex) {
    return null
  }

  const root = socialGraph().getRoot()
  const isMuted = socialGraph().getMutedByUser(root).has(pubKeyHex)

  if (isMuted) {
    return (
      <span
        className={`rounded-full aspect-square p-[2px] text-white bg-error ${className}`}
        title="Muted"
      >
        <RiVolumeMuteLine size={12} />
      </span>
    )
  }

  const distance = socialGraph().getFollowDistance(pubKeyHex)
  if (distance <= 2) {
    let tooltip
    let badgeClass
    if (distance === 0) {
      tooltip = "You"
      badgeClass = "bg-primary"
    } else if (distance === 1) {
      tooltip = "Following"
      badgeClass = "bg-primary"
    } else if (distance === 2) {
      const followedByFriends = socialGraph().followedByFriends(pubKeyHex)
      tooltip = `Followed by ${followedByFriends.size} friends`
      badgeClass = followedByFriends.size > 10 ? "bg-accent" : "bg-neutral"
    }
    return (
      <span
        className={`rounded-full aspect-square p-[2px] text-white ${badgeClass} ${className}`}
        title={tooltip}
      >
        <RiCheckLine size={12} />
      </span>
    )
  }
  return null
}
