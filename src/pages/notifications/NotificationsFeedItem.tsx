import EventBorderless from "@/shared/components/event/EventBorderless.tsx"

import RelativeTime from "@/shared/components/event/RelativeTime.tsx"
import {Avatar} from "@/shared/components/user/Avatar.tsx"
import {ProfileHoverCard} from "@/shared/components/user/ProfileHoverCard"
import {useHoverCard} from "@/shared/components/user/useHoverCard"
import HyperText from "@/shared/components/HyperText"
import {MouseEvent, useEffect, useState} from "react"
import {Notification} from "@/utils/notifications"
import {useNavigate, Link} from "@/navigation"
import {getTag} from "@/utils/nostr"
import {cacheEvent} from "@/utils/eventCache"
import {formatAmount} from "@/utils/utils.ts"
import classNames from "classnames"
import {nip19} from "nostr-tools"
import {
  RiChat1Fill,
  RiHeartFill,
  RiRepeatFill,
  RiFlashlightFill,
  RiNotificationFill,
} from "@remixicon/react"
import {
  KIND_TEXT_NOTE,
  KIND_REACTION,
  KIND_REPOST,
  KIND_ZAP_RECEIPT,
  KIND_WALLET_CONNECT,
} from "@/utils/constants"

interface NotificationsFeedItemProps {
  notification: Notification
  highlight: boolean
}

// Separate component for each avatar to avoid hooks in loops
interface NotificationAvatarProps {
  pubKey: string
  emoji?: string | null
  zapAmount?: number | null
}

function NotificationAvatar({pubKey, emoji, zapAmount}: NotificationAvatarProps) {
  const {hoverProps, showCard} = useHoverCard(true)

  const getCornerBadgeContent = () => {
    if (zapAmount && zapAmount > 0) {
      return formatAmount(zapAmount)
    }
    if (emoji && emoji.length <= 2) {
      return emoji === "+" ? "❤️" : emoji
    }
    return null
  }

  const cornerBadgeContent = getCornerBadgeContent()

  return (
    <div className="relative inline-block mr-2" {...hoverProps}>
      <Link
        className="inline"
        to={`/${nip19.npubEncode(pubKey)}`}
        onClick={(e) => e.stopPropagation()}
      >
        <Avatar
          pubKey={pubKey}
          width={30}
          showHoverCard={false}
          cornerBadge={
            cornerBadgeContent
              ? {
                  content: cornerBadgeContent,
                  position: "bottom-right",
                  className: zapAmount
                    ? "text-yellow-600 bg-yellow-100 font-medium"
                    : undefined,
                  shape: zapAmount ? "rounded" : "circle",
                }
              : undefined
          }
        />
      </Link>
      <ProfileHoverCard pubKey={pubKey} showCard={showCard} />
    </div>
  )
}

function NotificationsFeedItem({notification, highlight}: NotificationsFeedItemProps) {
  const navigate = useNavigate()

  const [type, setType] = useState<string>()
  const [description, setDescription] = useState<string>()

  // Calculate total zapped amount
  const totalZappedAmount =
    notification.kind === KIND_ZAP_RECEIPT
      ? Array.from(notification.users.values()).reduce((total, userInfo) => {
          const amount = userInfo.content ? parseInt(userInfo.content) || 0 : 0
          return total + amount
        }, 0)
      : 0

  const handleNavigateToReplyEvent = (e: MouseEvent) => {
    if (e.target instanceof Element && e.target.closest("a")) {
      return
    }
    try {
      const targetId =
        notification.kind === KIND_TEXT_NOTE
          ? notification.id
          : notification.originalEventId
      const targetEvent = notification.events.find(
        (ev) => ev.event.id === targetId
      )?.event
      if (targetEvent) cacheEvent(targetEvent)
      navigate(`/${nip19.noteEncode(targetId)}`)
    } catch (error) {
      console.warn(error)
    }
  }

  useEffect(() => {
    const t = notification.tags ? getTag("type", notification.tags) : null
    if (t) setType(t)

    const desc = notification.tags ? getTag("desc", notification.tags) : null
    if (desc) setDescription(desc)
  }, [notification])

  const getNotificationIcon = () => {
    switch (notification.kind) {
      case KIND_TEXT_NOTE:
        return <RiChat1Fill className="w-5 h-5 text-blue-500" />
      case KIND_REACTION:
        return <RiHeartFill className="w-5 h-5 text-pink-500" />
      case KIND_REPOST:
        return <RiRepeatFill className="w-5 h-5 text-green-500" />
      case KIND_ZAP_RECEIPT:
        return <RiFlashlightFill className="w-5 h-5 text-yellow-500" />
      case KIND_WALLET_CONNECT:
        return <RiNotificationFill className="w-5 h-5 text-purple-500" />
      default:
        return <RiNotificationFill className="w-5 h-5 text-gray-500" />
    }
  }

  if (!notification.originalEventId) return null

  return (
    <div
      className={classNames(
        "flex flex-col p-4 md:px-8 border-b border-custom transition-colors duration-1000 cursor-pointer hover:bg-[var(--note-hover-color)]",
        {"bg-info/20": highlight}
      )}
      onClick={handleNavigateToReplyEvent}
    >
      <div className="flex items-start justify-between text-base-content/75">
        <div className="flex items-start gap-3 flex-1">
          <div className="flex-shrink-0 mt-1">{getNotificationIcon()}</div>
          <div className="flex flex-col gap-2 flex-1">
            <div className="flex flex-row items-center flex-wrap">
              {Array.from(notification.users.entries())
                .reverse()
                .slice(0, 5)
                .map(([key, userInfo]) => {
                  const isReaction = notification.kind === KIND_REACTION
                  const isZap = notification.kind === KIND_ZAP_RECEIPT
                  const emoji = isReaction && userInfo.content ? userInfo.content : null
                  const zapAmount =
                    isZap && userInfo.content ? parseInt(userInfo.content) || 0 : null

                  return (
                    <NotificationAvatar
                      key={key}
                      pubKey={key}
                      emoji={emoji}
                      zapAmount={zapAmount}
                    />
                  )
                })}
              <span className="ml-1" />
              {notification.users.size > 5 && (
                <span className="inline font-bold">
                  and {notification.users.size - 5} others
                </span>
              )}
              <span className="ml-1 font-bold">
                {" "}
                {/* TODO: get original post and say "to your post" it was yours */}
                {notification.kind === KIND_TEXT_NOTE && "replied"}
                {notification.kind === KIND_REACTION && "reacted"}
                {notification.kind === KIND_REPOST && "reposted"}
                {notification.kind === KIND_ZAP_RECEIPT && (
                  <>
                    zapped
                    {totalZappedAmount > 0 && (
                      <span className="text-yellow-600 font-semibold ml-1">
                        {formatAmount(totalZappedAmount)}₿
                      </span>
                    )}
                  </>
                )}
                {notification.kind === KIND_WALLET_CONNECT && type && description}
              </span>
            </div>
            {notification.kind === KIND_TEXT_NOTE && (
              <div className="rounded-lg mt-1 px-3 py-4 cursor-pointer">
                <div className="overflow-hidden text-ellipsis">
                  <HyperText>{notification.content}</HyperText>
                </div>
              </div>
            )}
            {notification.kind !== KIND_TEXT_NOTE && (
              <div className="py-4">
                <EventBorderless
                  eventId={notification.originalEventId}
                  contentOnly={true}
                />
              </div>
            )}
          </div>
        </div>
        <span className="text-base-content/50 flex-shrink-0">
          <RelativeTime from={notification.time * 1000} />
        </span>
      </div>
    </div>
  )
}

export default NotificationsFeedItem
