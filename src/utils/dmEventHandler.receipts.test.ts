import {beforeEach, describe, expect, it, vi} from "vitest"

import {KIND_CHAT_MESSAGE} from "@/utils/constants"
import {useDevicesStore} from "@/stores/devices"
import {useMessagesStore} from "@/stores/messages"
import {useUserStore} from "@/stores/user"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useMessageRequestsStore} from "@/stores/messageRequests"

const MY_PUBKEY = "a".repeat(64)
const THEIR_PUBKEY = "b".repeat(64)
const MY_DEVICE_PUBKEY = "c".repeat(64)
const SIBLING_DEVICE_PUBKEY = "d".repeat(64)

type SessionEventCallback = (event: any, pubKey: string) => void
type SessionEventMeta = {
  senderOwnerPubkey?: string
  senderDevicePubkey?: string
  isSelf?: boolean
  isCrossDeviceSelf?: boolean
}

type CapturedSessionEventCallback = (
  event: any,
  pubKey: string,
  meta?: SessionEventMeta
) => void

let capturedCallback: CapturedSessionEventCallback | null = null

const sessionManager = {
  init: vi.fn().mockResolvedValue(undefined),
  onEvent: vi.fn((cb: CapturedSessionEventCallback) => {
    capturedCallback = cb
    return () => {}
  }),
  sendReceipt: vi.fn().mockResolvedValue(undefined),
  getUserRecords: vi.fn(() => new Map()),
}

const isFollowing = vi.fn((..._args: unknown[]) => false)

vi.mock("./socialGraph", () => ({
  getSocialGraph: () => ({
    getMutedByUser: () => new Set<string>(),
    isFollowing,
  }),
}))

vi.mock("@/shared/services/PrivateChats", () => ({}))

import {attachSessionEventListener, cleanupSessionEventListener} from "./dmEventHandler"

const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve))

describe("dmEventHandler receipts", () => {
  beforeEach(async () => {
    cleanupSessionEventListener()
    capturedCallback = null
    sessionManager.init.mockClear()
    sessionManager.onEvent.mockClear()
    sessionManager.sendReceipt.mockClear()
    sessionManager.getUserRecords.mockReset()
    sessionManager.getUserRecords.mockReturnValue(new Map())
    isFollowing.mockReset()
    isFollowing.mockReturnValue(false)

    useUserStore.setState({publicKey: MY_PUBKEY})
    useDevicesStore.setState({
      identityPubkey: MY_DEVICE_PUBKEY,
      registeredDevices: [{identityPubkey: MY_DEVICE_PUBKEY, createdAt: 1}],
      isCurrentDeviceRegistered: true,
      appKeysManagerReady: true,
      sessionManagerReady: true,
      hasLocalAppKeys: true,
      lastEventTimestamp: 1,
      pendingAutoRegistration: false,
      canSendPrivateMessages: true,
    })
    useMessagesStore.setState({
      sendDeliveryReceipts: true,
      sendReadReceipts: true,
      receiveMessageRequests: true,
    })
    useMessageRequestsStore.setState({acceptedChats: {}, rejectedChats: {}})

    await usePrivateMessagesStore.getState().clear()
  })

  it("does not send delivery receipts when disabled", async () => {
    useMessagesStore.setState({sendDeliveryReceipts: false})

    attachSessionEventListener(sessionManager as any)
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

    attachSessionEventListener(sessionManager as any)
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

    const stored = usePrivateMessagesStore
      .getState()
      .events.get(THEIR_PUBKEY)
      ?.get("msg-2")
    expect(stored).toBeTruthy()
    expect(stored?.status).not.toBe("delivered")
  })

  it("sends delivery receipts when enabled for followed users", async () => {
    useMessagesStore.setState({sendDeliveryReceipts: true})
    isFollowing.mockReturnValue(true)

    attachSessionEventListener(sessionManager as any)
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

  it("treats a session-backed sibling chat as accepted", async () => {
    useMessagesStore.setState({sendDeliveryReceipts: true})
    sessionManager.getUserRecords.mockReturnValue(
      new Map([
        [
          THEIR_PUBKEY,
          {
            devices: new Map([
              [
                "device-1",
                {
                  activeSession: {
                    state: {
                      theirCurrentNostrPublicKey: THEIR_PUBKEY,
                      theirNextNostrPublicKey: "e".repeat(64),
                    },
                  },
                  inactiveSessions: [],
                },
              ],
            ]),
          },
        ],
      ])
    )

    attachSessionEventListener(sessionManager as any)
    await flushPromises()

    capturedCallback?.(
      {
        id: "msg-session-backed",
        kind: KIND_CHAT_MESSAGE,
        pubkey: THEIR_PUBKEY,
        content: "hello from accepted sibling session",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", MY_PUBKEY]],
      },
      THEIR_PUBKEY
    )

    expect(sessionManager.sendReceipt).toHaveBeenCalledWith(
      THEIR_PUBKEY,
      "delivered",
      ["msg-session-backed"]
    )

    const stored = usePrivateMessagesStore
      .getState()
      .events.get(THEIR_PUBKEY)
      ?.get("msg-session-backed")
    expect(stored?.status).toBe("delivered")
  })

  it("stores delivered/seen timestamps from receipt events for our messages", async () => {
    attachSessionEventListener(sessionManager as any)
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

    let stored = usePrivateMessagesStore
      .getState()
      .events.get(THEIR_PUBKEY)
      ?.get(messageId)
    expect(stored?.status).toBe("delivered")
    expect(stored?.deliveredAt).toBe(deliveredAt)
    expect(stored?.seenAt).toBeUndefined()
    expect(stored?.deliveredTo).toEqual([
      {
        pubkey: THEIR_PUBKEY,
        timestamp: deliveredAt,
      },
    ])
    expect(stored?.seenBy).toBeUndefined()

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
    expect(stored?.deliveredTo).toEqual([
      {
        pubkey: THEIR_PUBKEY,
        timestamp: deliveredAt,
      },
    ])
    expect(stored?.seenBy).toEqual([
      {
        pubkey: THEIR_PUBKEY,
        timestamp: seenAt,
      },
    ])
  })

  it("marks incoming messages seen and updates lastSeen when seen receipt comes from own session", async () => {
    attachSessionEventListener(sessionManager as any)
    await flushPromises()

    expect(sessionManager.onEvent).toHaveBeenCalledTimes(1)
    expect(capturedCallback).toBeTruthy()

    const messageId = "in-1"
    const incomingAt = 1700000005123

    await usePrivateMessagesStore.getState().upsert(THEIR_PUBKEY, MY_PUBKEY, {
      id: messageId,
      kind: KIND_CHAT_MESSAGE,
      pubkey: THEIR_PUBKEY,
      ownerPubkey: THEIR_PUBKEY,
      content: "hello",
      created_at: Math.floor(incomingAt / 1000),
      tags: [
        ["p", MY_PUBKEY],
        ["ms", String(incomingAt)],
      ],
    } as any)

    const beforeSeen = usePrivateMessagesStore.getState().lastSeen.get(THEIR_PUBKEY) || 0
    expect(beforeSeen).toBe(0)

    const seenAt = incomingAt + 1000
    capturedCallback?.(
      {
        id: "rcpt-own-1",
        kind: 15,
        pubkey: MY_PUBKEY,
        content: "seen",
        created_at: Math.floor(seenAt / 1000),
        tags: [
          ["p", THEIR_PUBKEY],
          ["e", messageId],
          ["ms", String(seenAt)],
        ],
      },
      THEIR_PUBKEY
    )

    await flushPromises()

    const state = usePrivateMessagesStore.getState()
    const stored = state.events.get(THEIR_PUBKEY)?.get(messageId)
    expect(stored?.status).toBe("seen")
    expect(stored?.seenAt).toBe(seenAt)
    expect((state.lastSeen.get(THEIR_PUBKEY) || 0) >= incomingAt).toBe(true)
  })

  it("ignores incoming message requests when disabled", async () => {
    useMessagesStore.setState({receiveMessageRequests: false})
    isFollowing.mockReturnValue(false)

    attachSessionEventListener(sessionManager as any)
    await flushPromises()

    capturedCallback?.(
      {
        id: "msg-4",
        kind: KIND_CHAT_MESSAGE,
        pubkey: THEIR_PUBKEY,
        content: "hello",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", MY_PUBKEY]],
      },
      THEIR_PUBKEY
    )

    expect(sessionManager.sendReceipt).not.toHaveBeenCalled()
    expect(usePrivateMessagesStore.getState().events.get(THEIR_PUBKEY)).toBeUndefined()
  })

  it("still receives incoming messages for accepted chats when requests are disabled", async () => {
    useMessagesStore.setState({receiveMessageRequests: false, sendDeliveryReceipts: true})
    isFollowing.mockReturnValue(false)
    useMessageRequestsStore.getState().acceptChat(THEIR_PUBKEY)

    attachSessionEventListener(sessionManager as any)
    await flushPromises()

    capturedCallback?.(
      {
        id: "msg-5",
        kind: KIND_CHAT_MESSAGE,
        pubkey: THEIR_PUBKEY,
        content: "hello",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", MY_PUBKEY]],
      },
      THEIR_PUBKEY
    )

    expect(
      usePrivateMessagesStore.getState().events.get(THEIR_PUBKEY)?.get("msg-5")
    ).toBeTruthy()
    expect(sessionManager.sendReceipt).toHaveBeenCalledWith(THEIR_PUBKEY, "delivered", [
      "msg-5",
    ])
  })

  it("normalizes self-chat events to the owner pubkey when p-tag targets our current device", async () => {
    attachSessionEventListener(sessionManager as any)
    await flushPromises()

    expect(capturedCallback).toBeTruthy()

    capturedCallback?.(
      {
        id: "self-msg-1",
        kind: KIND_CHAT_MESSAGE,
        pubkey: SIBLING_DEVICE_PUBKEY,
        content: "hello from sibling device",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", MY_DEVICE_PUBKEY]],
      },
      MY_PUBKEY
    )

    await flushPromises()

    expect(
      usePrivateMessagesStore.getState().events.get(MY_PUBKEY)?.get("self-msg-1")
    ).toBeTruthy()
    expect(
      usePrivateMessagesStore.getState().events.get(MY_DEVICE_PUBKEY)
    ).toBeUndefined()
  })

  it("routes cross-device self copies to the peer owner when the p-tag is a linked device", async () => {
    const THEIR_LINKED_DEVICE_PUBKEY = "e".repeat(64)
    sessionManager.getUserRecords.mockReturnValue(
      new Map([
        [
          THEIR_PUBKEY,
          {
            devices: new Map([
              [
                THEIR_LINKED_DEVICE_PUBKEY,
                {
                  activeSession: null,
                  inactiveSessions: [],
                },
              ],
            ]),
            appKeys: {
              getAllDevices: () => [{identityPubkey: THEIR_LINKED_DEVICE_PUBKEY}],
            },
          },
        ],
      ])
    )

    attachSessionEventListener(sessionManager as any)
    await flushPromises()

    capturedCallback?.(
      {
        id: "self-msg-linked-peer",
        kind: KIND_CHAT_MESSAGE,
        pubkey: SIBLING_DEVICE_PUBKEY,
        content: "hello to linked peer device",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", THEIR_LINKED_DEVICE_PUBKEY]],
      },
      MY_PUBKEY,
      {
        senderOwnerPubkey: MY_PUBKEY,
        senderDevicePubkey: SIBLING_DEVICE_PUBKEY,
        isSelf: true,
        isCrossDeviceSelf: true,
      }
    )

    await flushPromises()

    expect(
      usePrivateMessagesStore.getState().events.get(THEIR_PUBKEY)?.get("self-msg-linked-peer")
    ).toBeTruthy()
    expect(
      usePrivateMessagesStore.getState().events.get(THEIR_LINKED_DEVICE_PUBKEY)
    ).toBeUndefined()
  })
})
