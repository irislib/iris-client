import {beforeEach, describe, expect, it, vi} from "vitest"

import {KIND_CHAT_MESSAGE} from "@/utils/constants"
import {useMessagesStore} from "@/stores/messages"
import {useUserStore} from "@/stores/user"

const MY_PUBKEY = "a".repeat(64)
const THEIR_PUBKEY = "b".repeat(64)

type SessionEventCallback = (event: any, pubKey: string) => void

let capturedCallback: SessionEventCallback | null = null

const sessionManager = {
  init: vi.fn().mockResolvedValue(undefined),
  onEvent: vi.fn((cb: SessionEventCallback) => {
    capturedCallback = cb
    return () => {}
  }),
  sendReceipt: vi.fn().mockResolvedValue(undefined),
}

vi.mock("@/shared/services/PrivateChats", () => ({
  getSessionManager: () => sessionManager,
}))

import {attachSessionEventListener, cleanupSessionEventListener} from "./dmEventHandler"

const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve))

describe("dmEventHandler receipts", () => {
  beforeEach(() => {
    cleanupSessionEventListener()
    capturedCallback = null
    sessionManager.init.mockClear()
    sessionManager.onEvent.mockClear()
    sessionManager.sendReceipt.mockClear()

    useUserStore.setState({publicKey: MY_PUBKEY})
    useMessagesStore.setState({
      sendDeliveryReceipts: true,
      sendReadReceipts: true,
    })
  })

  it("does not send delivery receipts when disabled", async () => {
    useMessagesStore.setState({sendDeliveryReceipts: false})

    attachSessionEventListener()
    await flushPromises()

    expect(sessionManager.onEvent).toHaveBeenCalledTimes(1)
    expect(capturedCallback).toBeTruthy()

    capturedCallback?.(
      {
        id: "msg-1",
        kind: KIND_CHAT_MESSAGE,
        pubkey: THEIR_PUBKEY,
        content: "hello",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", MY_PUBKEY]],
      },
      THEIR_PUBKEY
    )

    expect(sessionManager.sendReceipt).not.toHaveBeenCalled()
  })

  it("sends delivery receipts when enabled", async () => {
    useMessagesStore.setState({sendDeliveryReceipts: true})

    attachSessionEventListener()
    await flushPromises()

    expect(sessionManager.onEvent).toHaveBeenCalledTimes(1)
    expect(capturedCallback).toBeTruthy()

    capturedCallback?.(
      {
        id: "msg-2",
        kind: KIND_CHAT_MESSAGE,
        pubkey: THEIR_PUBKEY,
        content: "hello",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", MY_PUBKEY]],
      },
      THEIR_PUBKEY
    )

    expect(sessionManager.sendReceipt).toHaveBeenCalledWith(THEIR_PUBKEY, "delivered", [
      "msg-2",
    ])
  })
})

