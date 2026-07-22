import {NDKEvent} from "@/lib/ndk"
import {KIND_REPOST, KIND_TEXT_NOTE} from "@/utils/constants"
import {ndk} from "@/utils/ndk"
import {
  getEventReplyReference,
  getEventRootReference,
  getHexEventIdFromThreadReference,
} from "./threadReferences"

export function getEventReplyingTo(event: NDKEvent) {
  return getHexEventIdFromThreadReference(getEventReplyReference(event))
}

export function isRepost(event: NDKEvent) {
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

export function getEventRoot(event: NDKEvent) {
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

export const NDKEventFromRawEvent = (rawEvent: RawEvent): NDKEvent => {
  const ndkEvent = new NDKEvent()
  ndkEvent.ndk = ndk()
  ndkEvent.kind = rawEvent.kind
  ndkEvent.id = rawEvent.id
  ndkEvent.content = rawEvent.content
  ndkEvent.tags = rawEvent.tags
  ndkEvent.created_at = rawEvent.created_at
  ndkEvent.sig = rawEvent.sig
  ndkEvent.pubkey = rawEvent.pubkey
  return ndkEvent
}
