import {getEventHash} from "nostr-tools"
import type {Rumor} from "nostr-double-ratchet"

export function createGroupRumor(
  groupId: string,
  ownerPubkey: string,
  event: {kind: number; content: string; tags?: string[][]},
  nowMs = Date.now()
): Rumor {
  const tags = (event.tags ?? []).map((tag) => [...tag])
  if (!tags.some((tag) => tag[0] === "l")) tags.unshift(["l", groupId])
  if (!tags.some((tag) => tag[0] === "ms")) tags.push(["ms", String(nowMs)])
  const rumor: Rumor = {
    id: "",
    pubkey: ownerPubkey,
    kind: event.kind,
    content: event.content,
    tags,
    created_at: Math.floor(nowMs / 1000),
  }
  rumor.id = getEventHash(rumor)
  return rumor
}

/** Native Iris Chat carries a serialized application rumor in the group envelope. */
export function unwrapGroupRumor(
  envelope: Rumor,
  groupId: string,
  senderOwner: string,
  senderDevice: string
): Rumor | null {
  let value: unknown
  try {
    value = JSON.parse(envelope.content)
  } catch {
    return envelope
  }
  if (!value || typeof value !== "object") return envelope
  const rumor = value as Rumor
  if (
    typeof rumor.pubkey !== "string" ||
    typeof rumor.kind !== "number" ||
    typeof rumor.content !== "string" ||
    typeof rumor.created_at !== "number" ||
    !Array.isArray(rumor.tags)
  )
    return envelope
  if (
    !rumor.tags.every(
      (tag) => Array.isArray(tag) && tag.every((part) => typeof part === "string")
    ) ||
    !rumor.tags.some((tag) => tag[0] === "l" && tag[1] === groupId) ||
    rumor.tags.some((tag) => tag[0] === "l" && tag[1] !== groupId) ||
    (rumor.pubkey !== senderOwner && rumor.pubkey !== senderDevice)
  )
    return null
  try {
    const id = getEventHash(rumor)
    if (rumor.id && rumor.id !== id) return null
    return {...rumor, id}
  } catch {
    return null
  }
}
