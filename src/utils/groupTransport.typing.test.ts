import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useDevicesStore} from "@/stores/devices"
import {useGroupsStore} from "@/stores/groups"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useTypingStore} from "@/stores/typingIndicators"
import {useUserStore} from "@/stores/user"

const MY_OWNER_PUBKEY = "a".repeat(64)
const MY_DEVICE_PUBKEY = "c".repeat(64)
const THEIR_OWNER_PUBKEY = "b".repeat(64)
const GROUP_ID = "group-typing"
const TYPING_KIND = 25
const CHAT_MESSAGE_KIND = 14

const hoisted = vi.hoisted(() => ({
  onDecryptedEvent: null as ((event: any) => void) | null,
}))

vi.mock("nostr-double-ratchet", () => {
  class MockGroupManager {
    constructor(options: {onDecryptedEvent: (event: any) => void}) {
      hoisted.onDecryptedEvent = options.onDecryptedEvent
    }

    async upsertGroup(): Promise<void> {
      return
    }

    removeGroup(): void {
      return
    }

    destroy(): void {
      return
    }

    async handleIncomingSessionEvent(): Promise<void> {
      return
    }

    async sendEvent(): Promise<{
      inner: {
        id: string
        kind: number
        content: string
        tags: string[][]
        created_at: number
        pubkey: string
      }
    }> {
      return {
        inner: {
          id: "mock-inner",
          kind: CHAT_MESSAGE_KIND,
          content: "",
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
          pubkey: MY_DEVICE_PUBKEY,
        },
      }
    }

    async rotateSenderKey(): Promise<void> {
      return
    }
  }

  return {
    GroupManager: MockGroupManager,
    GROUP_SENDER_KEY_DISTRIBUTION_KIND: 10411,
    isTyping: (rumor: {kind?: number}) => rumor.kind === TYPING_KIND,
    isExpired: () => false,
    getMillisecondTimestamp: (event: {created_at?: number; tags?: string[][]}) => {
      const msTag = event.tags?.find(([key]) => key === "ms")
      if (msTag?.[1]) {
        const parsed = Number(msTag[1])
        if (Number.isFinite(parsed)) return parsed
      }
      return (event.created_at ?? 0) * 1000
    },
  }
})

vi.mock("@/utils/ndk", () => ({
  ndk: () => ({
    subscribe: () => ({
      on: () => {},
      start: () => {},
      stop: () => {},
    }),
  }),
}))

import {
  attachGroupTransportListener,
  cleanupGroupTransportListener,
} from "./groupTransport"

const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve))

describe("groupTransport typing handling", () => {
  beforeEach(async () => {
    cleanupGroupTransportListener()
    hoisted.onDecryptedEvent = null

    useUserStore.setState({publicKey: MY_OWNER_PUBKEY})
    useDevicesStore.setState({identityPubkey: MY_DEVICE_PUBKEY})
    useGroupsStore.setState({groups: {}} as any)
    useTypingStore.getState().clearAll()
    await usePrivateMessagesStore.getState().clear()
  })

  afterEach(() => {
    cleanupGroupTransportListener()
  })

  it("keeps group typing events ephemeral and clears them on real messages", async () => {
    attachGroupTransportListener()
    expect(hoisted.onDecryptedEvent).toBeTruthy()

    hoisted.onDecryptedEvent?.({
      groupId: GROUP_ID,
      senderOwnerPubkey: THEIR_OWNER_PUBKEY,
      senderDevicePubkey: THEIR_OWNER_PUBKEY,
      inner: {
        id: "typing-1",
        kind: TYPING_KIND,
        content: "typing",
        created_at: 1_700_000_000,
        pubkey: THEIR_OWNER_PUBKEY,
        tags: [
          ["l", GROUP_ID],
          ["ms", "1700000000000"],
        ],
      },
    })

    await flushPromises()

    expect(useTypingStore.getState().isTyping.get(GROUP_ID)).toBe(true)
    expect(
      usePrivateMessagesStore.getState().events.get(GROUP_ID)?.get("typing-1")
    ).toBeUndefined()

    hoisted.onDecryptedEvent?.({
      groupId: GROUP_ID,
      senderOwnerPubkey: THEIR_OWNER_PUBKEY,
      senderDevicePubkey: THEIR_OWNER_PUBKEY,
      inner: {
        id: "msg-1",
        kind: CHAT_MESSAGE_KIND,
        content: "hello",
        created_at: 1_700_000_001,
        pubkey: THEIR_OWNER_PUBKEY,
        tags: [
          ["l", GROUP_ID],
          ["ms", "1700000001000"],
        ],
      },
    })

    await flushPromises()

    expect(useTypingStore.getState().isTyping.get(GROUP_ID)).toBeUndefined()
    expect(
      usePrivateMessagesStore.getState().events.get(GROUP_ID)?.get("msg-1")
    ).toBeTruthy()
  })
})
