import {useEffect, useState, useCallback} from "react"
import {RiMoreLine} from "@remixicon/react"
import classNames from "classnames"
import {Link} from "react-router"
import {nip19} from "nostr-tools"

import RelativeTime from "@/shared/components/event/RelativeTime.tsx"
import FeedItemDropdown from "../reactions/FeedItemDropdown.tsx"
import {UserRow} from "@/shared/components/user/UserRow.tsx"
import {EVENT_AVATAR_WIDTH} from "../../user/const.ts"
import {NostrEvent} from "nostr-tools"
import {getTagValue} from "@/utils/nostr"

type FeedItemHeaderProps = {
  event: NostrEvent
  referredEvent?: NostrEvent
  tight?: boolean
}

function FeedItemHeader({event, referredEvent, tight}: FeedItemHeaderProps) {
  const [publishedAt, setPublishedAt] = useState<number>(0)
  const [showDropdown, setShowDropdown] = useState(false)

  const [dropdownRef, setDropdownRef] = useState<HTMLDivElement | null>(null)
  const [dropdownIconRef, setDropdownIconRef] = useState<HTMLDivElement | null>(null)

  // handle long-form published timestamp
  useEffect(() => {
    const getPublishedAt = (eventData: NostrEvent) => {
      if (eventData && eventData.kind === 30023) {
        const published = getTagValue(eventData, "published_at")
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

  // hide dropdown when clicking outside of it
  useEffect(() => {
    const handleClickOutsideDropdown = (event: MouseEvent) => {
      if (
        showDropdown &&
        dropdownRef &&
        !dropdownRef.contains(event.target as Node) &&
        dropdownIconRef &&
        !dropdownIconRef?.contains(event.target as Node)
      ) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("click", handleClickOutsideDropdown)
    return () => {
      document.removeEventListener("click", handleClickOutsideDropdown)
    }
  }, [dropdownRef, dropdownIconRef])

  return (
    <header
      className={classNames("flex justify-between items-center px-4", {"mb-2": !tight})}
    >
      <div className="cursor-pointer font-bold">
        <UserRow
          avatarWidth={EVENT_AVATAR_WIDTH}
          showHoverCard={true}
          pubKey={
            (event.kind === 9735 && getTagValue(event, "P")
              ? getTagValue(event, "P")
              : referredEvent?.pubkey) || event.pubkey
          }
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
          ref={setDropdownIconRef}
          onClick={(e) => {
            e.stopPropagation()
            setShowDropdown(true)
          }}
        >
          <RiMoreLine className="h-6 w-6 cursor-pointer text-base-content/50" />
        </div>
        {showDropdown && (
          <div ref={setDropdownRef} className="z-40">
            <FeedItemDropdown onClose={onClose} event={referredEvent || event} />
          </div>
        )}
      </div>
    </header>
  )
}

export default FeedItemHeader
