import {getMillisecondTimestamp} from "nostr-double-ratchet/src"
import {useUserRecordsStore} from "@/stores/userRecords"
import {useEventsStore} from "@/stores/events"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {MessageType} from "@/pages/chats/message/Message"
import {useMemo} from "react"

interface UnseenMessagesBadgeProps {
  messages?: SortedMap<string, MessageType>
  lastSeen?: number
}

const UnseenMessagesBadge = ({messages, lastSeen}: UnseenMessagesBadgeProps) => {
  const {lastSeen: globalLastSeen} = useUserRecordsStore()
  const {events} = useEventsStore()

  // Global usage - check all sessions (for navsidebar/footer)
  const hasUnread = useMemo(() => {
    return Array.from(events.entries()).some(([sessionId, sessionEvents]) => {
      const [, latest] = sessionEvents.last() ?? []
      if (!latest) return false
      if (latest.pubkey === "user") return false

      const latestTime = getMillisecondTimestamp(latest)
      const lastSeenTime = globalLastSeen.get(sessionId)

      if (lastSeenTime === undefined) return false

      return latestTime > lastSeenTime
    })
  }, [events, globalLastSeen])

  // If props are provided, use them (for specific session usage)
  if (messages && lastSeen !== undefined) {
    const unseenMessages = Array.from(messages.entries())
      .filter(([, message]) => {
        if (!message.created_at) return false
        if (message.pubkey === "user") return false
        return message.created_at * 1000 > lastSeen
      })
      .slice(-10)

    if (unseenMessages.length === 0) {
      return null
    }

    return (
      <div className="flex items-center gap-1">
        <span className="badge badge-primary badge-sm">{unseenMessages.length}</span>
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
