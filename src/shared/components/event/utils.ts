import {getTag, NostrEventFromRawEvent} from "@/utils/nostr.ts"
import {NostrEvent, nip19} from "nostr-tools"
import {getPool, DEFAULT_RELAYS} from "@/utils/applesauce"

// TODO: This function needs to be properly converted from NDK to applesauce
export const handleEventContent = (
  event: NostrEvent,
  setReferredEvent: (event: NostrEvent) => void
): (() => void) | undefined => {
  try {
    if (event.kind === 6 || event.kind === 7) {
      let originalEvent
      try {
        originalEvent = event.content ? JSON.parse(event.content) : undefined
      } catch (error) {
        // ignore
      }
      if (originalEvent && originalEvent?.id) {
        const ndkEvent = NostrEventFromRawEvent(originalEvent)
        setReferredEvent(ndkEvent)
        return undefined // No cleanup needed
      } else {
        const eTag = getTag("e", event.tags)
        if (eTag) {
          const pool = getPool()
          const subscription = pool.subscription(DEFAULT_RELAYS, {ids: [eTag]})

          subscription.subscribe({
            next: (fetchedEvent) => {
              if (typeof fetchedEvent !== "string" && fetchedEvent && fetchedEvent.id) {
                setReferredEvent(fetchedEvent)
              }
            },
            error: (error) => {
              console.error("Subscription error:", error)
            },
          })

          return () => {
            // RxJS subscriptions auto-cleanup
          }
        }
      }
    }
  } catch (error) {
    console.warn(error)
  }

  return undefined
}
export const getEventIdHex = (event?: NostrEvent, eventId?: string) => {
  if (event?.id) {
    return event.id
  }
  if (eventId!.indexOf("n") === 0) {
    const data = nip19.decode(eventId!).data
    if (typeof data === "string") {
      return data
    }
    return (data as nip19.EventPointer).id || ""
  }
  if (!eventId) {
    throw new Error("FeedItem requires either an event or an eventId")
  }
  return eventId
}
