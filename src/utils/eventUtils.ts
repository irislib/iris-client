import {AppEvent} from "@/lib/nostr"
import {KIND_REPOST, KIND_TEXT_NOTE} from "@/utils/constants"
import {nostr} from "@/utils/nostrClient"
import {
  getEventReplyReference,
  getEventRootReference,
  getHexEventIdFromThreadReference,
} from "./threadReferences"

export function getEventReplyingTo(event: AppEvent) {
  return getHexEventIdFromThreadReference(getEventReplyReference(event))
}

export function isRepost(event: AppEvent) {
  if (event.kind === KIND_REPOST) {
    return true
  }
  const mentionIndex = event.tags?.findIndex(
    (tag) => tag[0] === "e" && tag[3] === "mention"
  )
  if (event.kind === KIND_TEXT_NOTE && event.content === `#[${mentionIndex}]`) {
    return true
  }
  return false
}

export function getEventRoot(event: AppEvent) {
  return getHexEventIdFromThreadReference(getEventRootReference(event))
}

export type RawEvent = {
  id: string
  kind: number
  created_at: number
  content: string
  tags: string[][]
  sig: string
  pubkey: string
}

export const eventFromRawEvent = (rawEvent: RawEvent): AppEvent => {
  const ndkEvent = new AppEvent()
  ndkEvent.nostr = nostr()
  ndkEvent.kind = rawEvent.kind
  ndkEvent.id = rawEvent.id
  ndkEvent.content = rawEvent.content
  ndkEvent.tags = rawEvent.tags
  ndkEvent.created_at = rawEvent.created_at
  ndkEvent.sig = rawEvent.sig
  ndkEvent.pubkey = rawEvent.pubkey
  return ndkEvent
}
