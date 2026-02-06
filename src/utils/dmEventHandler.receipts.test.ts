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

  it("stores delivered/seen timestamps from receipt events for our messages", async () => {
    attachSessionEventListener()
    await flushPromises()

    expect(sessionManager.onEvent).toHaveBeenCalledTimes(1)
    expect(capturedCallback).toBeTruthy()

    const messageId = "out-1"
    await usePrivateMessagesStore.getState().upsert(THEIR_PUBKEY, MY_PUBKEY, {
      id: messageId,
      kind: KIND_CHAT_MESSAGE,
      pubkey: MY_PUBKEY,
      ownerPubkey: MY_PUBKEY,
      content: "hi",
      created_at: 1,
      tags: [["p", THEIR_PUBKEY]],
    } as any)

    const deliveredAt = 1700000000123
    capturedCallback?.(
      {
        id: "rcpt-1",
        kind: 15,
        pubkey: THEIR_PUBKEY,
        content: "delivered",
        created_at: Math.floor(deliveredAt / 1000),
        tags: [
          ["p", MY_PUBKEY],
          ["e", messageId],
          ["ms", String(deliveredAt)],
        ],
      },
      THEIR_PUBKEY
    )

    await flushPromises()

    let stored = usePrivateMessagesStore.getState().events.get(THEIR_PUBKEY)?.get(messageId)
    expect(stored?.status).toBe("delivered")
    expect(stored?.deliveredAt).toBe(deliveredAt)
    expect(stored?.seenAt).toBeUndefined()

    const seenAt = deliveredAt + 1000
    capturedCallback?.(
      {
        id: "rcpt-2",
        kind: 15,
        pubkey: THEIR_PUBKEY,
        content: "seen",
        created_at: Math.floor(seenAt / 1000),
        tags: [
          ["p", MY_PUBKEY],
          ["e", messageId],
          ["ms", String(seenAt)],
        ],
      },
      THEIR_PUBKEY
    )

    await flushPromises()

    stored = usePrivateMessagesStore.getState().events.get(THEIR_PUBKEY)?.get(messageId)
    expect(stored?.status).toBe("seen")
    expect(stored?.deliveredAt).toBe(deliveredAt)
    expect(stored?.seenAt).toBe(seenAt)
  })
})
