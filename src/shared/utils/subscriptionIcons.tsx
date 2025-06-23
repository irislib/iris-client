import {RiHeartFill, RiTrophyFill, RiShieldFill} from "@remixicon/react"

export type SubscriptionTier = "patron" | "champion" | "vanguard"

export const getSubscriptionIcon = (
  tier: SubscriptionTier | undefined,
  className = "text-warning",
  size?: number
) => {
  const iconProps = {
    className,
    ...(size ? {size} : {}),
  }

  switch (tier) {
    case "patron":
      return <RiHeartFill {...iconProps} className="text-error" />
    case "champion":
      return <RiTrophyFill {...iconProps} className="text-warning" />
    case "vanguard":
      return <RiShieldFill {...iconProps} className="text-primary" />
    default:
      return <RiHeartFill {...iconProps} className="text-error" />
  }
}
