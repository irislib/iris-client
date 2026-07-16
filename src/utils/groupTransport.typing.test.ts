import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useDevicesStore} from "@/stores/devices"
import {useChatExpirationStore} from "@/stores/chatExpiration"
import {useGroupsStore} from "@/stores/groups"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useTypingStore} from "@/stores/typingIndicators"
import {useUserStore} from "@/stores/user"
import {
  buildGroupRosterFactEvent,
  CHAT_SETTINGS_KIND,
  GROUP_ROSTER_FACT_KIND,
} from "nostr-double-ratchet"
import {getEventHash} from "nostr-tools"

const MY_OWNER_PUBKEY = "a".repeat(64)
const MY_DEVICE_PUBKEY = "c".repeat(64)
const THEIR_OWNER_PUBKEY = "b".repeat(64)
const GROUP_ID = "group-typing"
const TYPING_KIND = 25
const CHAT_MESSAGE_KIND = 14

const hoisted = vi.hoisted(() => ({
  onGroupEvent: null as ((event: any) => void) | null,
  setExpirationForGroup: vi.fn().mockResolvedValue(undefined),
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
    setExpirationForGroup: hoisted.setExpirationForGroup,
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
    hoisted.setExpirationForGroup.mockClear()
    hoisted.syncGroups.mockClear()

    useUserStore.setState({publicKey: MY_OWNER_PUBKEY})
    useDevicesStore.setState({identityPubkey: MY_DEVICE_PUBKEY})
    useGroupsStore.setState({groups: {}} as any)
    useChatExpirationStore.setState({expirations: {}})
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

  it("applies canonical pairwise GroupRoster facts without storing control messages", async () => {
    attachGroupMessageListener()
    const group = {
      id: GROUP_ID,
      name: "Canonical Group",
      description: "shared roster",
      members: [MY_OWNER_PUBKEY, THEIR_OWNER_PUBKEY],
      admins: [THEIR_OWNER_PUBKEY],
      createdAt: 1_700_000_000_000,
    }
    const unsigned = buildGroupRosterFactEvent(group, {
      signerPubkey: THEIR_OWNER_PUBKEY,
      revision: 7,
      createdBy: THEIR_OWNER_PUBKEY,
      updatedAt: 1_700_000_100,
      eventCreatedAt: 1_700_000_100,
      protocol: "sender_key_v1",
    })
    const roster = {...unsigned, id: getEventHash(unsigned)}

    hoisted.onGroupEvent?.({
      groupId: GROUP_ID,
      senderOwnerPubkey: THEIR_OWNER_PUBKEY,
      senderDevicePubkey: THEIR_OWNER_PUBKEY,
      inner: roster,
    })
    await flushPromises()

    expect(roster.kind).toBe(GROUP_ROSTER_FACT_KIND)
    expect(useGroupsStore.getState().groups[GROUP_ID]).toMatchObject({
      name: "Canonical Group",
      description: "shared roster",
      rosterRevision: 7,
      accepted: false,
    })
    expect(usePrivateMessagesStore.getState().events.get(GROUP_ID)).toBeUndefined()
  })

  it("accepts group chat settings only from a roster admin", async () => {
    useGroupsStore.setState({
      groups: {
        [GROUP_ID]: {
          id: GROUP_ID,
          name: "Group",
          members: [MY_OWNER_PUBKEY, THEIR_OWNER_PUBKEY],
          admins: [THEIR_OWNER_PUBKEY],
          createdAt: Date.now(),
        },
      },
    } as any)
    attachGroupMessageListener()

    hoisted.onGroupEvent?.({
      groupId: GROUP_ID,
      senderOwnerPubkey: THEIR_OWNER_PUBKEY,
      senderDevicePubkey: THEIR_OWNER_PUBKEY,
      inner: {
        id: "settings-1",
        kind: CHAT_SETTINGS_KIND,
        content: JSON.stringify({
          type: "chat-settings",
          v: 1,
          messageTtlSeconds: 3600,
        }),
        created_at: 1_700_000_000,
        pubkey: THEIR_OWNER_PUBKEY,
        tags: [["l", GROUP_ID]],
      },
    })
    await flushPromises()

    expect(useGroupsStore.getState().groups[GROUP_ID].messageTtlSeconds).toBe(3600)
    expect(useChatExpirationStore.getState().expirations[GROUP_ID]).toBe(3600)
    expect(hoisted.setExpirationForGroup).toHaveBeenCalledWith(GROUP_ID, {
      ttlSeconds: 3600,
    })
  })
})
