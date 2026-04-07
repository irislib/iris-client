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
  onGroupEvent: null as ((event: any) => void) | null,
  syncGroups: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/shared/services/PrivateChats", () => ({
  getNdrRuntime: () => ({
    onGroupEvent: (cb: (event: any) => void) => {
      hoisted.onGroupEvent = cb
      return () => {
        hoisted.onGroupEvent = null
      }
    },
    syncGroups: hoisted.syncGroups,
  }),
}))

import {
  attachGroupMessageListener,
  cleanupGroupMessageListener,
} from "./groupMessageHandler"

const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve))

describe("groupMessageHandler", () => {
  beforeEach(async () => {
    cleanupGroupMessageListener()
    hoisted.onGroupEvent = null
    hoisted.syncGroups.mockClear()

    useUserStore.setState({publicKey: MY_OWNER_PUBKEY})
    useDevicesStore.setState({identityPubkey: MY_DEVICE_PUBKEY})
    useGroupsStore.setState({groups: {}} as any)
    useTypingStore.getState().clearAll()
    await usePrivateMessagesStore.getState().clear()
  })

  afterEach(() => {
    cleanupGroupMessageListener()
  })

  it("keeps group typing events ephemeral and clears them on real messages", async () => {
    attachGroupMessageListener()
    expect(hoisted.onGroupEvent).toBeTruthy()

    hoisted.onGroupEvent?.({
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

    hoisted.onGroupEvent?.({
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

  it("syncs current groups into the runtime when attached", async () => {
    const group = {
      id: GROUP_ID,
      name: "Group",
      description: "",
      picture: "",
      members: [MY_OWNER_PUBKEY],
      admins: [MY_OWNER_PUBKEY],
      createdAt: Date.now(),
      accepted: true,
    }
    useGroupsStore.setState({groups: {[GROUP_ID]: group}} as any)

    attachGroupMessageListener()

    await flushPromises()

    expect(hoisted.syncGroups).toHaveBeenCalledWith([group])
  })
})
