import {readFileSync} from "node:fs"
import type {OnEventMeta, Rumor} from "nostr-double-ratchet"
import {parsePrivateContactControl} from "nostr-social-graph/privateContactSyncV2"
import {validPrivateDeviceLabel} from "./privateDeviceLabelProtocol"
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
let durableCallback:
  ((event: Rumor, from: string, meta?: OnEventMeta) => Promise<void>) | undefined
const durableReceive = vi.hoisted(() =>
  vi.fn(async (_event: Rumor, _meta?: OnEventMeta) => {})
)
const durableLabelReceive = vi.hoisted(() =>
  vi.fn(async (_event: Rumor, _meta?: OnEventMeta) => {})
)
vi.mock("./privateDeviceLabels", () => ({
  DEVICE_LABEL_CONTROL_KIND: 10453,
  receivePrivateDeviceLabel: durableLabelReceive,
}))
vi.mock("./privateContactControl", () => ({
  PRIVATE_CONTACT_CONTROL_KIND: 10452,
  receivePrivateContactControl: durableReceive,
}))

const sessionManager = {
  init: vi.fn().mockResolvedValue(undefined),
  onDurableSessionEvent: vi.fn(
    (_kinds: readonly number[], callback: NonNullable<typeof durableCallback>) => {
      durableCallback = callback
      return () => {
        durableCallback = undefined
      }
    }
  ),
  onSessionEvent: vi.fn((cb: CapturedSessionEventCallback) => {
    capturedCallback = cb
    return () => {}
  }),
  sendReceipt: vi.fn().mockResolvedValue(undefined),
  setExpirationForPeer: vi.fn().mockResolvedValue(undefined),
  setExpirationForGroup: vi.fn().mockResolvedValue(undefined),
  getSessionUserRecords: vi.fn(() => new Map()),
}

const isFollowing = vi.fn((..._args: unknown[]) => false)

vi.mock("./socialGraph", () => ({
  getSocialGraph: () => ({
    getMutedByUser: () => new Set<string>(),
    isFollowing,
  }),
}))

vi.mock("@/shared/services/PrivateChats", () => ({
  refreshOwnAppKeysFromRelay: vi.fn(async () => false),
}))

import {
  attachNdrRuntimeEventListener,
  cleanupNdrRuntimeEventListener,
} from "./dmEventHandler"

const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve))

describe("dmEventHandler receipts", () => {
  beforeEach(async () => {
    cleanupNdrRuntimeEventListener()
    capturedCallback = null
    sessionManager.init.mockClear()
    sessionManager.onSessionEvent.mockClear()
    sessionManager.sendReceipt.mockClear()
    sessionManager.getSessionUserRecords.mockReset()
    sessionManager.getSessionUserRecords.mockReturnValue(new Map())
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

  it("routes native messages without a recipient tag using the authenticated sender", async () => {
    attachNdrRuntimeEventListener(sessionManager as any)
    capturedCallback?.(
      {
        id: "native-message",
        kind: KIND_CHAT_MESSAGE,
        pubkey: THEIR_PUBKEY,
        content: "Native message",
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["ndr-protocol", "pairwise-rumor"],
          ["ndr-version", "1"],
        ],
      },
      THEIR_PUBKEY,
      {senderOwnerPubkey: THEIR_PUBKEY, senderDevicePubkey: "f".repeat(64), isSelf: false}
    )
    await flushPromises()
    expect(
      usePrivateMessagesStore.getState().events.get(THEIR_PUBKEY)?.get("native-message")
        ?.content
    ).toBe("Native message")
  })

  it("keeps linked-device mute controls out of message history", async () => {
    attachNdrRuntimeEventListener(sessionManager as any)
    capturedCallback?.(
      {
        id: "mute-control",
        kind: 10449,
        pubkey: MY_PUBKEY,
        content: JSON.stringify({
          type: "chat-mute",
          v: 1,
          mute: {
            chatId: THEIR_PUBKEY,
            untilSecs: 0,
            updatedAtMs: Date.now(),
          },
        }),
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", MY_PUBKEY]],
      },
      MY_PUBKEY,
      {
        isSelf: true,
        senderOwnerPubkey: MY_PUBKEY,
        senderDevicePubkey: SIBLING_DEVICE_PUBKEY,
      }
    )
    await flushPromises()
    expect(usePrivateMessagesStore.getState().events.size).toBe(0)
    expect(sessionManager.sendReceipt).not.toHaveBeenCalled()
  })

  it("does not send delivery receipts when disabled", async () => {
    useMessagesStore.setState({sendDeliveryReceipts: false})

    attachNdrRuntimeEventListener(sessionManager as any)
    await flushPromises()

    expect(sessionManager.onSessionEvent).toHaveBeenCalledTimes(1)
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

    attachNdrRuntimeEventListener(sessionManager as any)
    await flushPromises()

    expect(sessionManager.onSessionEvent).toHaveBeenCalledTimes(1)
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

    attachNdrRuntimeEventListener(sessionManager as any)
    await flushPromises()

    expect(sessionManager.onSessionEvent).toHaveBeenCalledTimes(1)
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

  it("keeps receive-only session-backed first-contact DMs as requests", async () => {
    useMessagesStore.setState({sendDeliveryReceipts: true})
    sessionManager.getSessionUserRecords.mockReturnValue(
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
                      sendingChainMessageNumber: 0,
                      previousSendingChainMessageCount: 0,
                      receivingChainMessageNumber: 1,
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

    attachNdrRuntimeEventListener(sessionManager as any)
    await flushPromises()

    capturedCallback?.(
      {
        id: "msg-session-request",
        kind: KIND_CHAT_MESSAGE,
        pubkey: THEIR_PUBKEY,
        content: "hello from unknown sender",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", MY_PUBKEY]],
      },
      THEIR_PUBKEY
    )

    expect(sessionManager.sendReceipt).not.toHaveBeenCalled()

    const stored = usePrivateMessagesStore
      .getState()
      .events.get(THEIR_PUBKEY)
      ?.get("msg-session-request")
    expect(stored).toBeTruthy()
    expect(stored?.status).not.toBe("delivered")
  })

  it("treats session-backed chats with outgoing activity as accepted", async () => {
    useMessagesStore.setState({sendDeliveryReceipts: true})
    sessionManager.getSessionUserRecords.mockReturnValue(
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
                      sendingChainMessageNumber: 1,
                      previousSendingChainMessageCount: 0,
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

    attachNdrRuntimeEventListener(sessionManager as any)
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

    expect(sessionManager.sendReceipt).toHaveBeenCalledWith(THEIR_PUBKEY, "delivered", [
      "msg-session-backed",
    ])

    const stored = usePrivateMessagesStore
      .getState()
      .events.get(THEIR_PUBKEY)
      ?.get("msg-session-backed")
    expect(stored?.status).toBe("delivered")
  })

  it("stores delivered/seen timestamps from receipt events for our messages", async () => {
    attachNdrRuntimeEventListener(sessionManager as any)
    await flushPromises()

    expect(sessionManager.onSessionEvent).toHaveBeenCalledTimes(1)
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
    attachNdrRuntimeEventListener(sessionManager as any)
    await flushPromises()

    expect(sessionManager.onSessionEvent).toHaveBeenCalledTimes(1)
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

    attachNdrRuntimeEventListener(sessionManager as any)
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

    attachNdrRuntimeEventListener(sessionManager as any)
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
    attachNdrRuntimeEventListener(sessionManager as any)
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
    sessionManager.getSessionUserRecords.mockReturnValue(
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

    attachNdrRuntimeEventListener(sessionManager as any)
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
      usePrivateMessagesStore
        .getState()
        .events.get(THEIR_PUBKEY)
        ?.get("self-msg-linked-peer")
    ).toBeTruthy()
    expect(
      usePrivateMessagesStore.getState().events.get(THEIR_LINKED_DEVICE_PUBKEY)
    ).toBeUndefined()
  })
})

describe("durable private control admission", () => {
  const rumor: Rumor = {
    id: "e".repeat(64),
    pubkey: MY_PUBKEY,
    created_at: 1,
    kind: 10452,
    tags: [],
    content: "{}",
  }
  const meta = {senderOwnerPubkey: MY_PUBKEY, senderDevicePubkey: SIBLING_DEVICE_PUBKEY}
  beforeEach(() => {
    cleanupNdrRuntimeEventListener()
    durableReceive.mockReset().mockResolvedValue(undefined)
    useUserStore.setState({publicKey: MY_PUBKEY})
    useDevicesStore.setState({
      identityPubkey: MY_DEVICE_PUBKEY,
      registeredDevices: [{identityPubkey: MY_DEVICE_PUBKEY, createdAt: 1}],
      appKeysManagerReady: true,
      sessionManagerReady: true,
      hasLocalAppKeys: true,
      lastEventTimestamp: 1,
      isCurrentDeviceRegistered: true,
    })
    attachNdrRuntimeEventListener(sessionManager)
  })
  it("retains a new sibling journal row until the current roster includes it, then awaits durable application", async () => {
    if (!durableCallback) throw new Error("Missing durable listener")
    await expect(durableCallback(rumor, MY_PUBKEY, meta)).rejects.toThrow(
      "linked device list"
    )
    expect(durableReceive).not.toHaveBeenCalled()
    useDevicesStore.setState({
      registeredDevices: [
        {identityPubkey: MY_DEVICE_PUBKEY, createdAt: 1},
        {identityPubkey: SIBLING_DEVICE_PUBKEY, createdAt: 2},
      ],
    })
    durableReceive.mockRejectedValueOnce(new Error("disk full"))
    await expect(durableCallback(rumor, MY_PUBKEY, meta)).rejects.toThrow("disk full")
    await durableCallback(rumor, MY_PUBKEY, meta)
    expect(durableReceive).toHaveBeenCalledTimes(2)
  })
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    "retains a control until this device is registered (sender cached: %s, recipient tag: %s)",
    async (senderCached, recipientTag) => {
      if (!durableCallback) throw new Error("Missing durable listener")
      useDevicesStore.setState({
        isCurrentDeviceRegistered: false,
        registeredDevices: senderCached
          ? [{identityPubkey: SIBLING_DEVICE_PUBKEY, createdAt: 1}]
          : [],
      })
      const acknowledge = vi.fn()
      const replay = async () => {
        await durableCallback!(
          {...rumor, tags: recipientTag ? [["p", MY_PUBKEY]] : []},
          MY_PUBKEY,
          meta
        )
        acknowledge()
      }
      await expect(replay()).rejects.toThrow("linked device list")
      expect(acknowledge).not.toHaveBeenCalled()
      expect(durableReceive).not.toHaveBeenCalled()

      useDevicesStore.setState({
        isCurrentDeviceRegistered: true,
        registeredDevices: [
          {identityPubkey: MY_DEVICE_PUBKEY, createdAt: 2},
          {identityPubkey: SIBLING_DEVICE_PUBKEY, createdAt: 1},
        ],
      })
      let finishSave: (() => void) | undefined
      durableReceive.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishSave = resolve
          })
      )
      const delivery = replay()
      expect(durableReceive).toHaveBeenCalledTimes(1)
      expect(acknowledge).not.toHaveBeenCalled()
      if (!finishSave) throw new Error("Durable save was not started")
      finishSave()
      await delivery
      expect(acknowledge).toHaveBeenCalledTimes(1)
    }
  )
  it("acknowledges repeated unsupported sibling snapshots without blocking contact saves", async () => {
    if (!durableCallback) throw new Error("Missing durable listener")
    expect(sessionManager.onDurableSessionEvent).toHaveBeenLastCalledWith(
      expect.arrayContaining([10449, 10450, 10452, 10453]),
      expect.any(Function)
    )
    useDevicesStore.setState({
      registeredDevices: [
        {identityPubkey: MY_DEVICE_PUBKEY, createdAt: 1},
        {identityPubkey: SIBLING_DEVICE_PUBKEY, createdAt: 2},
      ],
    })
    const pending = new Map<string, Rumor>()
    const deliver = async (event: Rumor) => {
      pending.set(event.id, event)
      await durableCallback!(event, MY_PUBKEY, meta)
      pending.delete(event.id)
    }
    for (let index = 0; index < 20; index++) {
      for (const kind of [10449, 10450]) {
        await deliver({...rumor, id: `${kind}-${index}`, kind, tags: [["p", MY_PUBKEY]]})
        expect(pending.size).toBe(0)
      }
    }
    expect(durableReceive).not.toHaveBeenCalled()
    await deliver(rumor)
    expect(durableReceive).toHaveBeenCalledTimes(1)
    expect(pending.size).toBe(0)
  })
  it("retains an unresolved sibling but drains rejected owner or recipient controls", async () => {
    if (!durableCallback) throw new Error("Missing durable listener")
    const event = {...rumor, kind: 10449, tags: [["p", MY_PUBKEY]]}
    const pending = new Map<string, Rumor>()
    const deliver = async (value: Rumor, from = MY_PUBKEY, senderMeta = meta) => {
      pending.set(value.id, value)
      await durableCallback!(value, from, senderMeta)
      pending.delete(value.id)
    }
    await expect(deliver(event)).rejects.toThrow("linked device list")
    expect(pending.size).toBe(1)
    // A rejected recipient or owner is conclusive even before the roster catches up.
    await deliver({...event, id: "wrong-recipient", tags: [["p", THEIR_PUBKEY]]})
    await deliver({...event, id: "wrong-owner"}, THEIR_PUBKEY, {
      ...meta,
      senderOwnerPubkey: THEIR_PUBKEY,
    })
    expect([...pending.keys()]).toEqual([event.id])
    expect(durableReceive).not.toHaveBeenCalled()
    useDevicesStore.setState({
      registeredDevices: [
        {identityPubkey: MY_DEVICE_PUBKEY, createdAt: 1},
        {identityPubkey: SIBLING_DEVICE_PUBKEY, createdAt: 2},
      ],
    })
    await deliver(event)
    expect(pending.size).toBe(0)
    expect(durableReceive).not.toHaveBeenCalled()
  })
  it.each([
    {tags: [] as string[][], accepted: true},
    {tags: [["p", MY_PUBKEY]], accepted: true},
    {tags: [["p", THEIR_PUBKEY]], accepted: false},
    {
      tags: [
        ["p", MY_PUBKEY],
        ["p", THEIR_PUBKEY],
      ],
      accepted: false,
    },
  ])(
    "checks explicit recipients without requiring a native self tag: %j",
    async ({tags, accepted}) => {
      if (!durableCallback) throw new Error("Missing durable listener")
      useDevicesStore.setState({
        registeredDevices: [
          {identityPubkey: MY_DEVICE_PUBKEY, createdAt: 1},
          {identityPubkey: SIBLING_DEVICE_PUBKEY, createdAt: 2},
        ],
      })
      await durableCallback({...rumor, tags}, MY_PUBKEY, meta)
      expect(durableReceive).toHaveBeenCalledTimes(accepted ? 1 : 0)
    }
  )
  it("cannot acknowledge an old account journal after the UI switches accounts", async () => {
    if (!durableCallback) throw new Error("Missing durable listener")
    useUserStore.setState({publicKey: THEIR_PUBKEY})
    await expect(durableCallback(rumor, MY_PUBKEY, meta)).rejects.toThrow("not ready")
    expect(durableReceive).not.toHaveBeenCalled()
  })
})

it.skipIf(
  !process.env.IRIS_PRIVATE_CONTROL_FIXTURE_INPUT &&
    process.env.REQUIRE_PRIVATE_CONTROL_INTEROP !== "1"
)("dispatches actual native-produced current and legacy sibling controls", async () => {
  const input = process.env.IRIS_PRIVATE_CONTROL_FIXTURE_INPUT
  if (!input)
    throw new Error(
      "IRIS_PRIVATE_CONTROL_FIXTURE_INPUT must select the native core fixture"
    )
  const fixture = JSON.parse(readFileSync(input, "utf8")) as {
    version: number
    owner: string
    senderDevice: string
    recipientDevice: string
    cases: Array<{kind: number; event: Rumor; legacyEvent: Rumor}>
  }
  expect(fixture.version).toBe(1)
  expect(new Set(fixture.cases.map((value) => value.kind))).toEqual(
    new Set([10449, 10450, 10452, 10453])
  )
  cleanupNdrRuntimeEventListener()
  useUserStore.setState({publicKey: fixture.owner})
  const senderMeta = {
    senderOwnerPubkey: fixture.owner,
    senderDevicePubkey: fixture.senderDevice,
  }
  const registeredDevices = [
    {identityPubkey: fixture.recipientDevice, createdAt: 1},
    {identityPubkey: fixture.senderDevice, createdAt: 1},
  ]
  useDevicesStore.setState({
    identityPubkey: fixture.recipientDevice,
    registeredDevices,
    isCurrentDeviceRegistered: true,
    sessionManagerReady: true,
    appKeysManagerReady: true,
    hasLocalAppKeys: true,
    lastEventTimestamp: 1,
  })
  durableReceive.mockReset().mockImplementation(async (event) => {
    expect(
      parsePrivateContactControl(JSON.parse(event.content), fixture.owner).type
    ).toBe("private-contact-sync")
  })
  durableLabelReceive.mockReset().mockImplementation(async (event) => {
    expect(validPrivateDeviceLabel(JSON.parse(event.content), fixture.owner)).toBe(true)
  })
  attachNdrRuntimeEventListener(sessionManager)
  try {
    if (!durableCallback) throw new Error("Missing durable listener")
    for (const value of fixture.cases) {
      expect(value.event.tags).toContainEqual(["p", fixture.owner])
      expect(value.legacyEvent.tags.some((tag) => tag[0] === "p")).toBe(false)
      for (const event of [value.event, value.legacyEvent]) {
        const receiver =
          value.kind === 10452
            ? durableReceive
            : value.kind === 10453
              ? durableLabelReceive
              : undefined
        const before = receiver?.mock.calls.length ?? 0
        useDevicesStore.setState({isCurrentDeviceRegistered: false})
        await expect(durableCallback(event, fixture.owner, senderMeta)).rejects.toThrow(
          "linked device list"
        )
        expect(receiver?.mock.calls.length ?? 0).toBe(before)
        useDevicesStore.setState({isCurrentDeviceRegistered: true})
        await durableCallback(event, fixture.owner, senderMeta)
        expect(receiver?.mock.calls.length ?? 0).toBe(before + (receiver ? 1 : 0))
        for (const tags of [
          [["p", THEIR_PUBKEY]],
          [
            ["p", fixture.owner],
            ["p", THEIR_PUBKEY],
          ],
        ]) {
          await durableCallback({...event, tags}, fixture.owner, senderMeta)
        }
        expect(receiver?.mock.calls.length ?? 0).toBe(before + (receiver ? 1 : 0))
      }
    }
  } finally {
    cleanupNdrRuntimeEventListener()
  }
})
