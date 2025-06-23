import socialGraph from "@/utils/socialGraph.ts"
import {RiCheckLine} from "@remixicon/react"
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

  if (!loggedIn) {
    return null
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
