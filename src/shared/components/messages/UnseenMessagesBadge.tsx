import {getMillisecondTimestamp} from "nostr-double-ratchet/src"
import {useSessionsStore} from "@/stores/sessions"
import {useEventsStore} from "@/stores/events"
import {useMemo} from "react"

export default function UnseenMessagesBadge() {
  const {lastSeen} = useSessionsStore()
  const {events} = useEventsStore()

  const hasUnread = useMemo(() => {
    return Array.from(events.entries()).some(([sessionId, sessionEvents]) => {
      const [, latest] = sessionEvents.last() ?? []
      if (!latest) return false

      const latestTime = getMillisecondTimestamp(latest)
      const lastSeenTime = lastSeen.get(sessionId) || 0
      return latestTime > lastSeenTime
    })
  }, [events, lastSeen])

  return (
    <>
      {hasUnread && <div className="indicator-item badge badge-primary badge-xs"></div>}
    </>
  )
}
