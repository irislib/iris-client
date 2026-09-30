import {useEffect, useState, useCallback} from "react"
import {RiMoreLine} from "@remixicon/react"
import classNames from "classnames"
import {Link} from "@/navigation"
import {nip19} from "nostr-tools"

import RelativeTime from "@/shared/components/event/RelativeTime.tsx"
import FeedItemDropdown from "../reactions/FeedItemDropdown.tsx"
import Dropdown from "@/shared/components/ui/Dropdown.tsx"
import {UserRow} from "@/shared/components/user/UserRow.tsx"
import {EVENT_AVATAR_WIDTH} from "../../user/const.ts"
import {AppEvent} from "@/lib/nostr"
import {isRepost} from "@/utils/nostr"
import {KIND_ZAP_RECEIPT, KIND_REACTION} from "@/utils/constants"

type FeedItemHeaderProps = {
  event: AppEvent
  referredEvent?: AppEvent
  tight?: boolean
}

function FeedItemHeader({event, referredEvent, tight}: FeedItemHeaderProps) {
  const [publishedAt, setPublishedAt] = useState<number>(0)
  const [showDropdown, setShowDropdown] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState<{clientY?: number}>({})

  // handle long-form published timestamp
  useEffect(() => {
    const getPublishedAt = (eventData: AppEvent) => {
      if (eventData && eventData.kind === 30023) {
        const published = eventData.tagValue("published_at")
        if (published) {
          try {
            return Number(published)
          } catch (error) {
            // ignore
          }
        }
      }
      return null
    }

    const publishedAt = referredEvent
      ? getPublishedAt(referredEvent)
      : getPublishedAt(event)

    if (publishedAt) setPublishedAt(publishedAt)
  }, [event, referredEvent])

  const onClose = useCallback(() => setShowDropdown(false), [setShowDropdown])

  // Determine which user to display based on event type
  const getDisplayUser = () => {
    // For reposts, wait for referredEvent to avoid showing reposter's avatar
    if (isRepost(event) && !referredEvent) {
      return null
    }
    // For reactions, wait for referredEvent to avoid showing liker's avatar
    if (event.kind === KIND_REACTION && !referredEvent) {
      return null
    }
    // For zap receipts, show zap recipient if there's a referred post (post zap)
    // Otherwise don't show header (profile zap - handled by ZapReceiptHeader)
    if (event.kind === KIND_ZAP_RECEIPT) {
      if (!referredEvent) {
        // Profile zap - no large avatar
        return null
      }
      // Post zap - show the zap recipient (p tag), not the post author
      const zapRecipient = event.tags.find((tag) => tag[0] === "p")?.[1]
      return zapRecipient || null
    }
    // For events with referredEvent (reactions), show referred author
    // Otherwise show event author
    return referredEvent?.pubkey || event.pubkey
  }

  const displayUser = getDisplayUser()

  // Don't render if we're waiting for the referredEvent to load or zap receipt
  if (!displayUser) {
    return null
  }

  return (
    <header
      className={classNames("flex justify-between items-center px-4", {"mb-2": !tight})}
    >
      <div className="cursor-pointer font-bold">
        <UserRow
          avatarWidth={EVENT_AVATAR_WIDTH}
          showHoverCard={true}
          pubKey={displayUser}
        />
      </div>
      <div className="select-none flex justify-end items-center">
        <Link
          to={`/${nip19.noteEncode(event.id)}`}
          className="text-sm text-base-content/50 mr-2"
        >
          <RelativeTime
            from={(publishedAt || referredEvent?.created_at || event.created_at!) * 1000}
          />
        </Link>
        <div
          tabIndex={0}
          role="button"
          className="p-2"
          onClick={(e) => {
            e.stopPropagation()
            const buttonRect = e.currentTarget.getBoundingClientRect()
            setDropdownPosition({clientY: buttonRect.top})
            setShowDropdown(true)
          }}
        >
          <RiMoreLine className="h-6 w-6 cursor-pointer text-base-content/50" />
        </div>
        {showDropdown && (
          <div className="z-40">
            <Dropdown
              onClose={onClose}
              position={{
                clientY: dropdownPosition.clientY,
                alignRight: true,
              }}
            >
              <FeedItemDropdown onClose={onClose} event={referredEvent || event} />
            </Dropdown>
          </div>
        )}
      </div>
    </header>
  )
}

export default FeedItemHeader
