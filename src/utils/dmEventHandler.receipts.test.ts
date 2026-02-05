import {beforeEach, describe, expect, it, vi} from "vitest"

import {KIND_CHAT_MESSAGE} from "@/utils/constants"
import {useMessagesStore} from "@/stores/messages"
import {useUserStore} from "@/stores/user"
import {usePrivateMessagesStore} from "@/stores/privateMessages"

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

const isFollowing = vi.fn((..._args: unknown[]) => false)

vi.mock("./socialGraph", () => ({
  getSocialGraph: () => ({
    getMutedByUser: () => new Set<string>(),
    isFollowing,
  }),
}))

vi.mock("@/shared/services/PrivateChats", () => ({
  getSessionManager: () => sessionManager,
}))

import {attachSessionEventListener, cleanupSessionEventListener} from "./dmEventHandler"

const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve))

describe("dmEventHandler receipts", () => {
  beforeEach(async () => {
    cleanupSessionEventListener()
    capturedCallback = null
    sessionManager.init.mockClear()
    sessionManager.onEvent.mockClear()
    sessionManager.sendReceipt.mockClear()
    isFollowing.mockReset()
    isFollowing.mockReturnValue(false)

    useUserStore.setState({publicKey: MY_PUBKEY})
    useMessagesStore.setState({
      sendDeliveryReceipts: true,
      sendReadReceipts: true,
    })

    await usePrivateMessagesStore.getState().clear()
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

  it("does not send delivery receipts for unaccepted requests", async () => {
    useMessagesStore.setState({sendDeliveryReceipts: true})
    isFollowing.mockReturnValue(false)

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

    // Request threads should not send delivery receipts before we've followed or replied.
    expect(sessionManager.sendReceipt).not.toHaveBeenCalled()

    const stored = usePrivateMessagesStore.getState().events.get(THEIR_PUBKEY)?.get("msg-2")
    expect(stored).toBeTruthy()
    expect(stored?.status).not.toBe("delivered")
  })

  it("sends delivery receipts when enabled for followed users", async () => {
    useMessagesStore.setState({sendDeliveryReceipts: true})
    isFollowing.mockReturnValue(true)

    attachSessionEventListener()
    await flushPromises()

    expect(sessionManager.onEvent).toHaveBeenCalledTimes(1)
    expect(capturedCallback).toBeTruthy()

    capturedCallback?.(
      {
        id: "msg-3",
        kind: KIND_CHAT_MESSAGE,
        pubkey: THEIR_PUBKEY,
        content: "hello",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", MY_PUBKEY]],
      },
      THEIR_PUBKEY
    )

    expect(sessionManager.sendReceipt).toHaveBeenCalledWith(THEIR_PUBKEY, "delivered", [
      "msg-3",
    ])
  })
})
