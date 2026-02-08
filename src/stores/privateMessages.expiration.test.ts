import {beforeEach, describe, expect, it} from "vitest"

import type {MessageType} from "@/pages/chats/message/Message"
import {comparator} from "@/pages/chats/utils/messageGrouping"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {usePrivateMessagesStore} from "@/stores/privateMessages"

const makeMessage = (args: {id: string; pubkey: string; createdAtSec: number; expiresAtSec?: number}): MessageType => {
  const tags: string[][] = []
  if (args.expiresAtSec !== undefined) {
    tags.push(["expiration", String(args.expiresAtSec)])
  }
  tags.push(["ms", String(args.createdAtSec * 1000)])
  return {
    id: args.id,
    pubkey: args.pubkey,
    created_at: args.createdAtSec,
    kind: 14,
    content: "hi",
    tags,
  }
}

describe("usePrivateMessagesStore expiration purge", () => {
  beforeEach(async () => {
    await usePrivateMessagesStore.getState().clear()
  })

  it("removes expired messages from the in-memory chat map", async () => {
    const chatId = "b".repeat(64)

    const expired = makeMessage({
      id: "expired",
      pubkey: chatId,
      createdAtSec: 100,
      expiresAtSec: 150,
    })
    const active = makeMessage({
      id: "active",
      pubkey: chatId,
      createdAtSec: 200,
      expiresAtSec: 300,
    })

    const map = new SortedMap<string, MessageType>([], comparator)
    map.set(expired.id, expired)
    map.set(active.id, active)

    usePrivateMessagesStore.setState({
      events: new Map([[chatId, map]]),
      lastSeen: new Map(),
    })

    usePrivateMessagesStore.getState().purgeExpired(250)

    const stored = usePrivateMessagesStore.getState().events.get(chatId)
    expect(stored?.get("expired")).toBeUndefined()
    expect(stored?.get("active")).toBeTruthy()
  })
})

