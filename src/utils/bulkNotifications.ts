import type {Event} from "nostr-tools"
import {KIND_HIGHLIGHT, KIND_PICTURE_FIRST, KIND_TEXT_NOTE} from "./constants"

type Post = Pick<Event, "kind" | "tags" | "pubkey">
const hex = /^[0-9a-f]{64}$/
const postKinds = new Set([KIND_TEXT_NOTE, KIND_PICTURE_FIRST, KIND_HIGHLIGHT])

export function isBulkPost(event: Post): boolean {
  if (!postKinds.has(event.kind) || !Array.isArray(event.tags)) return false
  const recipients = new Set<string>()
  for (const tag of event.tags) {
    if (tag?.[0] === "p" && typeof tag[1] === "string" && hex.test(tag[1])) {
      recipients.add(tag[1])
      if (recipients.size > 10) return true
    }
  }
  return false
}

// NIP-10 applies to text notes. A picture or highlight can cite another event
// without replying to it. A quote or thread root is not a nested reply's parent.
export function immediateReplyTag(event: Post): string[] | undefined {
  if (event.kind !== KIND_TEXT_NOTE) return
  const refs = event.tags.filter(
    (t) => t?.[0] === "e" && hex.test(t[1]) && t[3] !== "mention"
  )
  const replies = refs.filter((t) => t[3] === "reply")
  if (replies.length === 1) return replies[0]
  if (refs.length === 1 && refs[0][3] === "root") return refs[0]
  if (refs.every((t) => !t[3])) return refs.at(-1)
}

export function allowsBulkPost(
  event: Post,
  viewer: string,
  follows: boolean,
  parentAuthor?: string
): boolean {
  if (!viewer || !event.tags.some((tag) => tag?.[0] === "p" && tag[1] === viewer))
    return false
  if (follows) return true
  const parent = immediateReplyTag(event)
  return !!parent && (parentAuthor || parent[4]) === viewer
}
