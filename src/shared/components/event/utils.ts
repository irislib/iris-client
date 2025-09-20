import {getTag, NDKEventFromRawEvent} from "@/utils/nostr.ts"
import {NDKEvent} from "@nostr-dev-kit/ndk"
import {nip19} from "nostr-tools"
import {ndk} from "@/utils/ndk"
import {KIND_REPOST, KIND_REACTION, KIND_ZAP_RECEIPT} from "@/utils/constants"
import {Hex} from "@/shared/utils/Hex"

export const handleEventContent = (
  event: NDKEvent,
  setReferredEvent: (event: NDKEvent) => void
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
        const ndkEvent = NDKEventFromRawEvent(originalEvent)
        setReferredEvent(ndkEvent)
        return undefined // No cleanup needed
      } else {
        const eTag = getTag("e", event.tags)
        if (eTag) {
          const sub = ndk().subscribe({ids: [eTag]}, {closeOnEose: true})

          sub.on("event", (fetchedEvent: NDKEvent) => {
            if (fetchedEvent && fetchedEvent.id) {
              setReferredEvent(fetchedEvent)
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

export const getEventIdHex = (eventOrId?: NDKEvent | string) => {
  if (!eventOrId) return null
  if (typeof eventOrId !== "string") return eventOrId.id
  return  tryDecodeNip19(eventOrId)||tryParseHex(eventOrId) || null
}
