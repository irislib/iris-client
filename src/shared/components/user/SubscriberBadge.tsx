import {useSubscriptionStatus} from "@/shared/hooks/useSubscriptionStatus"
import {getSubscriptionIcon} from "@/shared/utils/subscriptionIcons"
import {Link} from "react-router"

interface SubscriberBadgeProps {
  className?: string
  pubkey?: string
}

export function SubscriberBadge({className = "", pubkey}: SubscriberBadgeProps) {
  const {isSubscriber, isLoading, tier} = useSubscriptionStatus(pubkey)

  if (isLoading || !isSubscriber) return null

  const getBadgeText = () => {
    switch (tier) {
      case "patron":
        return "Patron"
      case "champion":
        return "Champion"
      case "vanguard":
        return "Vanguard"
      default:
        return "Subscriber"
    }
  }

  const getBorderColor = () => {
    switch (tier) {
      case "patron":
        return "border-error"
      case "champion":
        return "border-warning"
      case "vanguard":
        return "border-primary"
      default:
        return "border-warning"
    }
  }

  const getTextColor = () => {
    switch (tier) {
      case "patron":
        return "text-error"
      case "champion":
        return "text-warning"
      case "vanguard":
        return "text-primary"
      default:
        return "text-warning"
    }
  }

  return (
    <div className="inline-flex">
      <Link
        to="/subscribe"
        className={`flex items-center gap-1 ${className} px-2 rounded-full border ${getBorderColor()} bg-base-200 no-underline`}
      >
        {getSubscriptionIcon(tier)}
        <span className={`text-xs font-medium ${getTextColor()}`}>{getBadgeText()}</span>
      </Link>
    </div>
  )
}
