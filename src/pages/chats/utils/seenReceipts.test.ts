import {describe, expect, it, vi} from "vitest"
import type {MessageType} from "@/pages/chats/message/Message"

import {markMessagesSeenAndMaybeSendReceipt} from "./seenReceipts"

const MY_PUBKEY = "a".repeat(64)
const THEIR_PUBKEY = "b".repeat(64)

describe("markMessagesSeenAndMaybeSendReceipt", () => {
  it("marks incoming messages as seen but does not send when read receipts are disabled", () => {
    const updateMessage = vi.fn().mockResolvedValue(undefined)
    const sessionManager = {sendReceipt: vi.fn().mockResolvedValue(undefined)}

    const messages: MessageType[] = [
      {
        id: "m1",
        pubkey: THEIR_PUBKEY,
        ownerPubkey: THEIR_PUBKEY,
        content: "hi",
        kind: 14,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", MY_PUBKEY]],
      } as any,
      {
        id: "m2",
        pubkey: THEIR_PUBKEY,
        ownerPubkey: THEIR_PUBKEY,
        content: "already seen",
        kind: 14,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", MY_PUBKEY]],
        status: "seen",
      } as any,
      {
        id: "m3",
        pubkey: MY_PUBKEY,
        ownerPubkey: MY_PUBKEY,
        content: "my message",
        kind: 14,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", THEIR_PUBKEY]],
      } as any,
    ]

    const acked = markMessagesSeenAndMaybeSendReceipt({
      chatId: THEIR_PUBKEY,
      messages,
      myPubKey: MY_PUBKEY,
      updateMessage,
      sessionManager,
      sendReadReceipts: false,
    })

    expect(acked).toEqual(["m1"])
    expect(updateMessage).toHaveBeenCalledWith(THEIR_PUBKEY, "m1", {status: "seen"})
    expect(sessionManager.sendReceipt).not.toHaveBeenCalled()
  })

  it("sends a seen receipt when enabled", () => {
    const updateMessage = vi.fn().mockResolvedValue(undefined)
    const sessionManager = {sendReceipt: vi.fn().mockResolvedValue(undefined)}

    const messages: MessageType[] = [
      {
        id: "m1",
        pubkey: THEIR_PUBKEY,
        ownerPubkey: THEIR_PUBKEY,
        content: "hi",
        kind: 14,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", MY_PUBKEY]],
      } as any,
    ]

    const acked = markMessagesSeenAndMaybeSendReceipt({
      chatId: THEIR_PUBKEY,
      messages,
      myPubKey: MY_PUBKEY,
      updateMessage,
      sessionManager,
      sendReadReceipts: true,
    })

    expect(acked).toEqual(["m1"])
    expect(sessionManager.sendReceipt).toHaveBeenCalledWith(THEIR_PUBKEY, "seen", ["m1"])
  })
})

