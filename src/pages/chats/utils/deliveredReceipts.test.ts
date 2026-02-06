import {describe, expect, it, vi} from "vitest"
import type {MessageType} from "@/pages/chats/message/Message"

import {KIND_REACTION} from "@/utils/constants"
import {markMessagesDeliveredAndMaybeSendReceipt} from "./deliveredReceipts"

const MY_PUBKEY = "a".repeat(64)
const THEIR_PUBKEY = "b".repeat(64)

describe("markMessagesDeliveredAndMaybeSendReceipt", () => {
  it("does nothing when the chat is not accepted", () => {
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

    const acked = markMessagesDeliveredAndMaybeSendReceipt({
      chatId: THEIR_PUBKEY,
      messages,
      myPubKey: MY_PUBKEY,
      updateMessage,
      sessionManager,
      sendDeliveryReceipts: true,
      isChatAccepted: false,
    })

    expect(acked).toEqual([])
    expect(updateMessage).not.toHaveBeenCalled()
    expect(sessionManager.sendReceipt).not.toHaveBeenCalled()
  })

  it("marks incoming messages as delivered and sends delivered receipts when enabled", () => {
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
        content: "already delivered",
        kind: 14,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", MY_PUBKEY]],
        status: "delivered",
      } as any,
      {
        id: "m3",
        pubkey: THEIR_PUBKEY,
        ownerPubkey: THEIR_PUBKEY,
        content: "reaction should be ignored",
        kind: KIND_REACTION,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", MY_PUBKEY]],
      } as any,
      {
        id: "m4",
        pubkey: MY_PUBKEY,
        ownerPubkey: MY_PUBKEY,
        content: "my message",
        kind: 14,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", THEIR_PUBKEY]],
      } as any,
    ]

    const acked = markMessagesDeliveredAndMaybeSendReceipt({
      chatId: THEIR_PUBKEY,
      messages,
      myPubKey: MY_PUBKEY,
      updateMessage,
      sessionManager,
      sendDeliveryReceipts: true,
      isChatAccepted: true,
    })

    expect(acked).toEqual(["m1"])
    expect(updateMessage).toHaveBeenCalledWith(
      THEIR_PUBKEY,
      "m1",
      expect.objectContaining({status: "delivered", deliveredAt: expect.any(Number)})
    )
    expect(sessionManager.sendReceipt).toHaveBeenCalledWith(THEIR_PUBKEY, "delivered", ["m1"])
  })

  it("marks messages as delivered but does not send when delivery receipts are disabled", () => {
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

    const acked = markMessagesDeliveredAndMaybeSendReceipt({
      chatId: THEIR_PUBKEY,
      messages,
      myPubKey: MY_PUBKEY,
      updateMessage,
      sessionManager,
      sendDeliveryReceipts: false,
      isChatAccepted: true,
    })

    expect(acked).toEqual(["m1"])
    expect(updateMessage).toHaveBeenCalledWith(
      THEIR_PUBKEY,
      "m1",
      expect.objectContaining({status: "delivered", deliveredAt: expect.any(Number)})
    )
    expect(sessionManager.sendReceipt).not.toHaveBeenCalled()
  })
})

