import {UserRow} from "@/shared/components/user/UserRow"
import {RiFlashlightFill, RiMoreLine} from "@remixicon/react"
import {NDKEvent} from "@/lib/ndk"
import {useEffect, useState} from "react"
import {decode} from "light-bolt11-decoder"
import {formatAmount} from "@/utils/utils"
import {getZappingUser} from "@/utils/nostr"
import {ReactionContent} from "@/shared/components/event/reactions/ReactionContent"
import Dropdown from "@/shared/components/ui/Dropdown.tsx"
import FeedItemDropdown from "./reactions/FeedItemDropdown.tsx"

interface ZapReceiptHeaderProps {
  event: NDKEvent
  referredEvent?: NDKEvent
  showAuthor?: boolean
}

function ZapReceiptHeader({
  event,
  referredEvent,
  showAuthor = true,
}: ZapReceiptHeaderProps) {
  const [zappedAmount, setZappedAmount] = useState<number>()
  const [zapComment, setZapComment] = useState<string>("")
  const [showDropdown, setShowDropdown] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState<{clientY?: number}>({})
  const zappingUser = getZappingUser(event, false)

  useEffect(() => {
    const invoice = event.tagValue("bolt11")
    if (invoice) {
      const decodedInvoice = decode(invoice)
      const amountSection = decodedInvoice.sections.find(
        (section: {name: string}) => section.name === "amount"
      )
      if (amountSection && "value" in amountSection) {
        setZappedAmount(Math.floor(parseInt(amountSection.value) / 1000))
      }
    }

    const description = event.tagValue("description")
    if (description) {
      try {
        const descEvent = JSON.parse(description)
        setZapComment(descEvent.content || "")
      } catch (e) {
        // ignore
      }
    }
  }, [event])

  if (!zappingUser) {
    return null
  }

  const zapRecipient = event.tags.find((tag) => tag[0] === "P" || tag[0] === "p")?.[1]

  return (
    <div className="flex items-center gap-1 text-sm flex-wrap justify-between w-full">
      <div className="flex items-center gap-1 flex-wrap">
        <RiFlashlightFill className="w-4 h-4 text-yellow-500" />
        <span className="text-yellow-600 font-semibold">
          {formatAmount(zappedAmount || 0)}₿
        </span>
        {showAuthor && <UserRow pubKey={zappingUser} avatarWidth={20} />}
        <span className="text-base-content/50">→</span>
        {zapRecipient && (
          <UserRow pubKey={zapRecipient} avatarWidth={20} showAvatar={!referredEvent} />
        )}
        {zapComment && (
          <>
            <span className="text-base-content/50">:</span>
            <span className="break-words italic">
              &ldquo;
              <ReactionContent content={zapComment} event={event} />
              &rdquo;
            </span>
          </>
        )}
      </div>
      {!referredEvent && (
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
      )}
      {showDropdown && (
        <div className="z-40">
          <Dropdown
            onClose={() => setShowDropdown(false)}
            position={{
              clientY: dropdownPosition.clientY,
              alignRight: true,
            }}
          >
            <FeedItemDropdown onClose={() => setShowDropdown(false)} event={event} />
          </Dropdown>
        </div>
      )}
    </div>
  )
}

export default ZapReceiptHeader
