import {useState} from "react"
import Icon from "@/shared/components/Icons/Icon"
import {getEventKindInfo} from "@/utils/eventKinds.tsx"
import {NotificationSubscription, PushNotifications} from "@/utils/IrisAPI"

interface NotificationSubscriptionItemProps {
  id: string
  subscription: NotificationSubscription
  pushSubscription: PushNotifications | null
  fcmToken: string | null
  apnsToken: string | null
  currentEndpoint: string | null
  onDelete: (id: string) => void
  isSelected: boolean
  onToggleSelect: (id: string) => void
}

const getEndpointDisplay = (
  pushSubscription: PushNotifications | null,
  fcmToken: string | null,
  apnsToken: string | null,
  webhooks: unknown[]
) => {
  if (pushSubscription) {
    const url = new URL(pushSubscription.endpoint)
    const path = url.pathname
    const last4 = path.length > 4 ? path.slice(-4) : path
    return `${url.host}/...${last4}`
  }

  if (fcmToken) {
    return `FCM: ${fcmToken.slice(0, 8)}...${fcmToken.slice(-4)}`
  }

  if (apnsToken) {
    return `APNS: ${apnsToken.slice(0, 8)}...${apnsToken.slice(-4)}`
  }

  if (webhooks && webhooks.length > 0) {
    const webhook = webhooks[0]
    if (typeof webhook === "string") {
      return webhook
    }
    if (webhook && typeof webhook === "object" && "url" in webhook) {
      return (webhook as {url: string}).url
    }
    return "Webhook"
  }

  return "Filter only (no endpoints)"
}

const getSubscriptionTypeBadge = (
  pushSubscription: PushNotifications | null,
  fcmToken: string | null,
  apnsToken: string | null
) => {
  if (fcmToken) {
    return <span className="badge badge-sm badge-primary">Android FCM</span>
  }
  if (apnsToken) {
    return <span className="badge badge-sm badge-primary">iOS APNS</span>
  }
  if (pushSubscription) {
    return <span className="badge badge-sm badge-neutral">Web Push</span>
  }
  return null
}

const NotificationSubscriptionItem = ({
  id,
  subscription,
  pushSubscription,
  fcmToken,
  apnsToken,
  currentEndpoint,
  onDelete,
  isSelected,
  onToggleSelect,
}: NotificationSubscriptionItemProps) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const isCurrentDevice = currentEndpoint === pushSubscription?.endpoint

  const removeNullValues = (obj: Record<string, unknown>) => {
    return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== null))
  }

  return (
    <div className={`flex flex-col w-full ${isCurrentDevice ? "bg-primary/5" : ""}`}>
      <div className="flex w-full items-center gap-2 p-3">
        <input
          type="checkbox"
          className="checkbox checkbox-sm shrink-0"
          checked={isSelected}
          onChange={() => onToggleSelect(id)}
        />
        <button
          className="flex-1 flex items-start gap-2 text-left min-w-0"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <Icon
            name={isExpanded ? "chevron-down" : "chevron-right"}
            size={16}
            className="shrink-0 mt-0.5"
          />
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1">
              <span className="break-all">
                {getEndpointDisplay(
                  pushSubscription,
                  fcmToken,
                  apnsToken,
                  subscription.webhooks
                )}
              </span>
              {getSubscriptionTypeBadge(pushSubscription, fcmToken, apnsToken)}
              {subscription.social_graph_filter && (
                <span className="badge badge-sm badge-secondary">Social graph</span>
              )}
              {isCurrentDevice && (
                <span className="badge badge-primary text-xs shrink-0">This device</span>
              )}
            </div>
            {subscription.filter?.kinds && subscription.filter.kinds.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {subscription.filter.kinds.slice(0, 5).map((kind: number) => {
                  const info = getEventKindInfo(kind)
                  return (
                    <span
                      key={kind}
                      className="badge badge-xs badge-ghost flex items-center gap-0.5"
                      title={`Kind ${kind}`}
                    >
                      {info.icon && <span className={info.color}>{info.icon}</span>}
                      {info.label}
                    </span>
                  )
                })}
                {subscription.filter.kinds.length > 5 && (
                  <span className="badge badge-xs badge-ghost">
                    +{subscription.filter.kinds.length - 5}
                  </span>
                )}
              </div>
            )}
          </div>
        </button>
        <button
          className="btn btn-ghost btn-sm btn-square shrink-0"
          onClick={() => onDelete(id)}
          title="Delete subscription"
        >
          <Icon name="trash" size={16} className="text-error" />
        </button>
      </div>
      {isExpanded && (
        <div className="px-3 pb-3 border-t">
          {subscription.filter?.kinds && subscription.filter.kinds.length > 0 && (
            <div className="mt-2">
              <strong className="text-sm">Event Kinds:</strong>
              <div className="flex flex-wrap gap-1 mt-1">
                {subscription.filter.kinds.map((kind: number) => {
                  const info = getEventKindInfo(kind)
                  return (
                    <span
                      key={kind}
                      className="badge badge-sm badge-neutral flex items-center gap-1"
                      title={`Kind ${kind}`}
                    >
                      {info.icon && <span className={info.color}>{info.icon}</span>}
                      {info.label}
                    </span>
                  )
                })}
              </div>
            </div>
          )}
          <div className="mt-2">
            <strong className="text-sm">Full Filter:</strong>
          </div>
          <pre className="w-full overflow-x-auto whitespace-pre-wrap break-all bg-base-200 p-2 rounded text-sm mt-1">
            {JSON.stringify(removeNullValues(subscription.filter), null, 2)}
          </pre>
          <div className="mt-2 text-sm">
            <strong>Social Graph Filter:</strong>{" "}
            {subscription.social_graph_filter ? "On" : "Off"}
          </div>
        </div>
      )}
    </div>
  )
}

export default NotificationSubscriptionItem
