import {beforeEach, describe, expect, it} from "vitest"

import {usePrivateMessagesStore} from "@/stores/privateMessages"

describe("usePrivateMessagesStore updateMessage", () => {
  beforeEach(async () => {
    await usePrivateMessagesStore.getState().clear()
  })

  it("replaces the per-chat message map reference so UI memoization sees receipt/status updates", async () => {
    const chatId = "b".repeat(64)
    const myPubkey = "a".repeat(64)
    const messageId = "m1"

    await usePrivateMessagesStore.getState().upsert(chatId, myPubkey, {
      id: messageId,
      kind: 14,
      pubkey: myPubkey,
      ownerPubkey: myPubkey,
      content: "hello",
      created_at: 1,
      tags: [["p", chatId]],
      status: "delivered",
    } as any)

    const before = usePrivateMessagesStore.getState().events.get(chatId)
    expect(before).toBeTruthy()

    await usePrivateMessagesStore
      .getState()
      .updateMessage(chatId, messageId, {status: "seen"})

    const after = usePrivateMessagesStore.getState().events.get(chatId)
    expect(after).toBeTruthy()
    expect(after).not.toBe(before)
    expect(after?.get(messageId)?.status).toBe("seen")
  })
})
