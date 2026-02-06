import {getMillisecondTimestamp} from "nostr-double-ratchet/src"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {MessageType} from "@/pages/chats/message/Message"
import {useMemo} from "react"
import {useUserStore} from "@/stores/user"
import {countUnseenMessages} from "@/pages/chats/utils/unseenCount"

interface UnseenMessagesBadgeProps {
  messages?: SortedMap<string, MessageType>
  lastSeen?: number
}

const UnseenMessagesBadge = ({messages, lastSeen}: UnseenMessagesBadgeProps) => {
  const {events, lastSeen: lastSeenFromStore} = usePrivateMessagesStore()
  const myPubKey = useUserStore((state) => state.publicKey)

  // Global usage - check all sessions (for navsidebar/footer)
  const hasUnread = useMemo(() => {
    if (!myPubKey) return false
    for (const [chatId, sessionEvents] of events.entries()) {
      const [, latest] = sessionEvents.last() ?? []
      if (!latest) continue
      const owner = (latest as MessageType).ownerPubkey ?? (latest as MessageType).pubkey
      if (owner === myPubKey) continue
      const lastSeenForChat = lastSeenFromStore.get(chatId) || 0
      const latestTime = getMillisecondTimestamp(latest as MessageType)
      if (latestTime > lastSeenForChat) {
        return true
      }
    }
    return false
  }, [events, lastSeenFromStore, myPubKey])

  // If props are provided, use them (for specific session usage)
  if (messages && lastSeen !== undefined) {
    const count = countUnseenMessages({messages, lastSeenAtMs: lastSeen, myPubKey})
    if (count === 0) return null
    const label = count > 99 ? "99+" : String(count)

    return (
      <div className="flex items-center gap-1">
        <span className="badge badge-primary badge-sm">{label}</span>
      </div>
    )
  }

  // Global usage - return the unread indicator
  return (
    <>
      {hasUnread && <div className="indicator-item badge badge-primary badge-xs"></div>}
    </>
  )
}

export default UnseenMessagesBadge
