import {beforeEach, describe, expect, it, vi} from "vitest"
import {GROUP_SENDER_KEY_MESSAGE_KIND} from "nostr-double-ratchet"

import {useChatExpirationStore} from "@/stores/chatExpiration"
import {useGroupsStore} from "@/stores/groups"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useUserStore} from "@/stores/user"

const MY_PUBKEY = "a".repeat(64)
const GROUP_ID = "group-1"

const {sendGroupEventViaTransport} = vi.hoisted(() => ({
  sendGroupEventViaTransport: vi.fn(),
}))

vi.mock("@/utils/groupTransport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/groupTransport")>()
  return {
    ...actual,
    sendGroupEventViaTransport,
  }
})

import {sendGroupEvent} from "./groupMessaging"

const makeGroup = (messageTtlSeconds: number | null) => ({
  id: GROUP_ID,
  name: "Group",
  description: "",
  picture: "",
  members: [MY_PUBKEY],
  admins: [MY_PUBKEY],
  createdAt: Date.now(),
  accepted: true,
  messageTtlSeconds,
})

describe("sendGroupEvent expiration", () => {
  beforeEach(async () => {
    sendGroupEventViaTransport.mockReset()
    useUserStore.setState({publicKey: MY_PUBKEY})
    useChatExpirationStore.setState({expirations: {}})
    useGroupsStore.setState({groups: {}} as any)
    await usePrivateMessagesStore.getState().clear()

    let counter = 0
    sendGroupEventViaTransport.mockImplementation(
      async ({
        kind,
        content,
        tags,
        senderPubKey,
      }: {
        kind: number
        content: string
        tags: string[][]
        senderPubKey: string
      }) => {
        counter += 1
        return {
          inner: {
            id: `event-${counter}`,
            kind,
            content,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            pubkey: senderPubKey,
          },
        }
      }
    )
  })

  it("adds expiration tag when a group TTL exists in chat expiration store", async () => {
    const nowMs = 1_700_000_000_000
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(nowMs)
    useChatExpirationStore.setState({expirations: {[GROUP_ID]: 3600}})

    try {
      await sendGroupEvent({
        groupId: GROUP_ID,
        groupMembers: [MY_PUBKEY],
        senderPubKey: MY_PUBKEY,
        content: "hello",
        kind: GROUP_SENDER_KEY_MESSAGE_KIND,
      })
    } finally {
      nowSpy.mockRestore()
    }

    const sentTags = sendGroupEventViaTransport.mock.calls[0][0].tags as string[][]
    const expirationTag = sentTags.find(([key]) => key === "expiration")
    expect(expirationTag?.[1]).toBe(String(Math.floor(nowMs / 1000) + 3600))
  })

  it("falls back to group metadata TTL when chat expiration store is unset", async () => {
    const nowMs = 1_700_001_000_000
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(nowMs)
    useGroupsStore.setState({
      groups: {
        [GROUP_ID]: makeGroup(120),
      },
    } as any)

    try {
      await sendGroupEvent({
        groupId: GROUP_ID,
        groupMembers: [MY_PUBKEY],
        senderPubKey: MY_PUBKEY,
        content: "hello",
        kind: GROUP_SENDER_KEY_MESSAGE_KIND,
      })
    } finally {
      nowSpy.mockRestore()
    }

    const sentTags = sendGroupEventViaTransport.mock.calls[0][0].tags as string[][]
    const expirationTag = sentTags.find(([key]) => key === "expiration")
    expect(expirationTag?.[1]).toBe(String(Math.floor(nowMs / 1000) + 120))
  })

  it("does not add expiration when chat expiration is explicitly off", async () => {
    useChatExpirationStore.setState({expirations: {[GROUP_ID]: null}})
    useGroupsStore.setState({
      groups: {
        [GROUP_ID]: makeGroup(300),
      },
    } as any)

    await sendGroupEvent({
      groupId: GROUP_ID,
      groupMembers: [MY_PUBKEY],
      senderPubKey: MY_PUBKEY,
      content: "hello",
      kind: GROUP_SENDER_KEY_MESSAGE_KIND,
    })

    const sentTags = sendGroupEventViaTransport.mock.calls[0][0].tags as string[][]
    const expirationTag = sentTags.find(([key]) => key === "expiration")
    expect(expirationTag).toBeUndefined()
  })
})
