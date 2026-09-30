import {getTag, eventFromRawEvent} from "@/utils/nostr.ts"
import {AppEvent} from "@/lib/nostr"
import {nip19} from "nostr-tools"
import {nostr} from "@/utils/nostrClient"
import {KIND_REPOST, KIND_REACTION, KIND_ZAP_RECEIPT} from "@/utils/constants"
import {Hex} from "@/shared/utils/Hex"

export const handleEventContent = (
  event: AppEvent,
  setReferredEvent: (event: AppEvent) => void
): (() => void) | undefined => {
  try {
    if (
      event.kind === KIND_REPOST ||
      event.kind === KIND_REACTION ||
      event.kind === KIND_ZAP_RECEIPT
    ) {
      let originalEvent
      try {
        originalEvent = event.content ? JSON.parse(event.content) : undefined
      } catch (error) {
        // ignore
      }
      if (originalEvent && originalEvent?.id) {
        const ndkEvent = eventFromRawEvent(originalEvent)
        setReferredEvent(ndkEvent)
        return undefined // No cleanup needed
      } else {
        const eTag = getTag("e", event.tags)
        if (eTag) {
          const sub = nostr().subscribe({ids: [eTag]})

          sub.on("event", (fetchedEvent: AppEvent) => {
            if (fetchedEvent && fetchedEvent.id) {
              setReferredEvent(fetchedEvent)
              sub.stop()
            }
          })

          return () => {
            sub.stop()
          }
        }
      }
    }
  } catch (error) {
    console.warn(error)
  }

  return undefined
}

const tryDecodeNip19 = (eventId: string) => {
  try {
    const decoded = nip19.decode(eventId)
    if (typeof decoded.data === "string") return decoded.data
    if (decoded.type === "nevent") return decoded.data.id
  } catch {
    return null
  }
}

const tryParseHex = (eventId: string) => {
  try {
    const hex = new Hex(eventId, 64)
    return hex.toString()
  } catch {
    return null
  }
}

export const getEventIdHex = (eventOrId?: AppEvent | string) => {
  if (!eventOrId) return null
  if (typeof eventOrId !== "string") return eventOrId.id
  return tryDecodeNip19(eventOrId) || tryParseHex(eventOrId) || null
}
