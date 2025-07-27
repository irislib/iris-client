import {useCallback, MouseEvent, useState, memo, useEffect} from "react"
import {eventsByIdCache} from "@/utils/memcache"
import ErrorBoundary from "../ui/ErrorBoundary"
import {NostrEvent, nip19} from "nostr-tools"
import RelativeTime from "./RelativeTime"
import {useNavigate} from "react-router"
import {UserRow} from "../user/UserRow"
import {RawEvent} from "@/utils/nostr"
import HyperText from "../HyperText"
import {getPool, DEFAULT_RELAYS} from "@/utils/applesauce"

interface EventBorderlessProps {
  event?: RawEvent | NostrEvent
  eventId?: string
  contentOnly?: boolean
}

function isRawEvent(event: RawEvent | NostrEvent): event is RawEvent {
  return (event as RawEvent).kind !== undefined
}

function EventBorderless({
  event: initialEvent,
  eventId,
  contentOnly,
}: EventBorderlessProps) {
  const navigate = useNavigate()

  const onClickEvent = useCallback(
    (e: MouseEvent, ev: RawEvent) => {
      if (contentOnly || (e.target instanceof Element && e.target.closest("a"))) {
        return
      }
      navigate(`/${nip19.noteEncode(ev.id)}`)
    },
    [navigate]
  )

  const [event, setEvent] = useState(
    initialEvent || (eventId && eventsByIdCache.get(eventId))
  )

  useEffect(() => {
    if (!event && eventId) {
      const pool = getPool()
      const subscription = pool.subscription(DEFAULT_RELAYS, {ids: [eventId]})

      const sub = subscription.subscribe({
        next: (e) => {
          if (typeof e !== "string" && e && e.id) {
            setEvent(e)
            eventsByIdCache.set(e.id, e)
          }
        },
        error: (error) => {
          console.error("Event fetch error:", error)
        },
      })

      return () => sub.unsubscribe()
    }
  }, [event, eventId])

  if (!event && !eventId) {
    throw new Error("must provide either event or eventId")
  }

  if (!event) {
    return null
  }

  return (
    <ErrorBoundary>
      <div
        onClick={(e) => {
          if (isRawEvent(event)) {
            onClickEvent(e, event)
          }
        }}
        className="flex flex-col gap-2 text-sm cursor-pointer text-2xl"
      >
        {!contentOnly && (
          <div className="flex flex-row items-center justify-between">
            <span className="font-bold">
              <UserRow pubKey={event.pubkey} />
            </span>
            {event.created_at && (
              <span className="text-base-content/50">
                <RelativeTime from={event.created_at * 1000} />
              </span>
            )}
          </div>
        )}
        <HyperText truncate={75} expandable={false} small={true}>
          {event.content.replace("\n", " ")}
        </HyperText>
      </div>
    </ErrorBoundary>
  )
}

export default memo(EventBorderless)
