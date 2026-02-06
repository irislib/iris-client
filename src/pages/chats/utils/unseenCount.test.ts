import {describe, expect, it} from "vitest"

import type {MessageType} from "@/pages/chats/message/Message"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {comparator} from "@/pages/chats/utils/messageGrouping"

import {countUnseenMessages} from "./unseenCount"

const MY_PUBKEY = "a".repeat(64)
const THEIR_PUBKEY = "b".repeat(64)
const MY_DEVICE_PUBKEY = "c".repeat(64)

const makeMessage = ({
  id,
  pubkey,
  ownerPubkey,
  created_at,
}: {
  id: string
  pubkey: string
  ownerPubkey?: string
  created_at: number
}): MessageType =>
  ({
    id,
    kind: 14,
    pubkey,
    ...(ownerPubkey ? {ownerPubkey} : {}),
    content: id,
    created_at,
    tags: [],
  }) as any

describe("countUnseenMessages", () => {
  it("counts messages newer than lastSeen from others (ownerPubkey aware)", () => {
    const messages = new SortedMap<string, MessageType>([], comparator)
    messages.set(
      "m1",
      makeMessage({id: "m1", pubkey: THEIR_PUBKEY, ownerPubkey: THEIR_PUBKEY, created_at: 100})
    )
    messages.set(
      "m2",
      makeMessage({id: "m2", pubkey: MY_DEVICE_PUBKEY, ownerPubkey: MY_PUBKEY, created_at: 110})
    )
    messages.set(
      "m3",
      makeMessage({id: "m3", pubkey: THEIR_PUBKEY, ownerPubkey: THEIR_PUBKEY, created_at: 120})
    )

    expect(countUnseenMessages({messages, lastSeenAtMs: 115_000, myPubKey: MY_PUBKEY})).toBe(
      1
    )
  })

  it("counts all messages from others when lastSeen is 0", () => {
    const messages = new SortedMap<string, MessageType>([], comparator)
    messages.set(
      "m1",
      makeMessage({id: "m1", pubkey: THEIR_PUBKEY, ownerPubkey: THEIR_PUBKEY, created_at: 100})
    )
    messages.set(
      "m2",
      makeMessage({id: "m2", pubkey: MY_DEVICE_PUBKEY, ownerPubkey: MY_PUBKEY, created_at: 110})
    )
    messages.set(
      "m3",
      makeMessage({id: "m3", pubkey: THEIR_PUBKEY, ownerPubkey: THEIR_PUBKEY, created_at: 120})
    )

    expect(countUnseenMessages({messages, lastSeenAtMs: 0, myPubKey: MY_PUBKEY})).toBe(2)
  })

  it("returns 0 when messages or pubkey is missing", () => {
    expect(countUnseenMessages({messages: undefined, lastSeenAtMs: 0, myPubKey: MY_PUBKEY})).toBe(
      0
    )
    expect(countUnseenMessages({messages: undefined, lastSeenAtMs: 0, myPubKey: ""})).toBe(0)
  })
})

