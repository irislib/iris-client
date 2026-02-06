import {getMillisecondTimestamp} from "nostr-double-ratchet/src"

import type {MessageType} from "@/pages/chats/message/Message"
import type {SortedMap} from "@/utils/SortedMap/SortedMap"

export function countUnseenMessages({
  messages,
  lastSeenAtMs,
  myPubKey,
}: {
  messages?: SortedMap<string, MessageType> | null
  lastSeenAtMs: number
  myPubKey: string | null | undefined
}): number {
  if (!messages || !myPubKey) return 0
  if (messages.size === 0) return 0

  const cutoff = lastSeenAtMs || 0
  let count = 0
  for (const [, message] of messages.reverse()) {
    const ts = getMillisecondTimestamp(message)
    if (cutoff && ts <= cutoff) break

    const owner = message.ownerPubkey ?? message.pubkey
    if (owner === myPubKey) continue
    count++
  }
  return count
}

