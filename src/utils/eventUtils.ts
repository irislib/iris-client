import {NDKEvent} from "@/lib/ndk"
import {eventRegex} from "@/shared/components/embed/nostr/noteRegex"
import {KIND_REPOST, KIND_TEXT_NOTE} from "@/utils/constants"
import {ndk} from "@/utils/ndk"

export function getEventReplyingTo(event: NDKEvent) {
  if (event.kind !== KIND_TEXT_NOTE) {
    return undefined
  }
  const qEvent = event.tags?.find((tag) => tag[0] === "q")?.[1]
  const replyTags =
    event.tags?.filter((tag) => tag[0] === "e" && tag[3] !== "mention") || []
  if (replyTags.length === 1 && replyTags[0][1] !== qEvent) {
    return replyTags[0][1]
  }
  const replyTag = event.tags?.find((tag) => tag[0] === "e" && tag[3] === "reply")
  if (replyTag) {
    return replyTag[1]
  }
  // If there's a root tag and it's the only e tag (besides mentions),
  // it's a direct reply to the root
  const rootTag = event.tags?.find((tag) => tag[0] === "e" && tag[3] === "root")
  if (rootTag && replyTags.length === 1) {
    return rootTag[1]
  }
  return undefined
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
  const rootEvent = event?.tags?.find((t) => t[0] === "e" && t[3] === "root")?.[1]
  if (rootEvent) {
    return rootEvent
  }
  const quotedEvent = getQuotedEvent(event)
  // first e tag
  return event?.tags?.find((t) => t[0] === "e" && t[1] !== quotedEvent)?.[1]
}

export const getQuotedEvent = (event: NDKEvent): string | false => {
  const qTag = event.tagValue("q")
  if (event.kind === KIND_TEXT_NOTE && qTag) return qTag
  const mentionTag = event.tags
    .filter((tag) => tag[0] === "e")
    .find((tag) => tag[3] === "mention" && tag[1] === event.id)
  if (mentionTag) return mentionTag[1]
  const match = event.content.match(eventRegex)
  if (match) return match[1]
  return false
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
