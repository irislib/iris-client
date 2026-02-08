import {beforeEach, describe, expect, it, vi} from "vitest"

import {KIND_CHAT_SETTINGS} from "@/utils/constants"
import {useMessagesStore} from "@/stores/messages"
import {useUserStore} from "@/stores/user"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useMessageRequestsStore} from "@/stores/messageRequests"
import {useChatExpirationStore} from "@/stores/chatExpiration"
import {useGroupsStore} from "@/stores/groups"

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
  setExpirationForPeer: vi.fn().mockResolvedValue(undefined),
  setExpirationForGroup: vi.fn().mockResolvedValue(undefined),
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

describe("dmEventHandler expiration settings", () => {
  beforeEach(async () => {
    cleanupSessionEventListener()
    capturedCallback = null
    sessionManager.init.mockClear()
    sessionManager.onEvent.mockClear()
    sessionManager.sendReceipt.mockClear()
    sessionManager.setExpirationForPeer.mockClear()
    sessionManager.setExpirationForGroup.mockClear()
    isFollowing.mockReset()
    isFollowing.mockReturnValue(true)

    useUserStore.setState({publicKey: MY_PUBKEY})
    useMessagesStore.setState({
      sendDeliveryReceipts: true,
      sendReadReceipts: true,
      receiveMessageRequests: true,
    })
    useMessageRequestsStore.setState({acceptedChats: {}, rejectedChats: {}})
    useChatExpirationStore.setState({expirations: {}})
    useGroupsStore.setState({groups: {}} as any)

    await usePrivateMessagesStore.getState().clear()
  })

  it("applies disappearing message TTL from incoming settings messages (and persists it per chat)", async () => {
    attachSessionEventListener()
    await flushPromises()

    expect(sessionManager.onEvent).toHaveBeenCalledTimes(1)
    expect(capturedCallback).toBeTruthy()

    capturedCallback?.(
      {
        id: "settings-1",
        kind: KIND_CHAT_SETTINGS,
        pubkey: THEIR_PUBKEY,
        content: JSON.stringify({type: "chat-settings", v: 1, messageTtlSeconds: 3600}),
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", MY_PUBKEY]],
      },
      THEIR_PUBKEY
    )

    await flushPromises()

    expect(useChatExpirationStore.getState().expirations[THEIR_PUBKEY]).toBe(3600)
    expect(sessionManager.setExpirationForPeer).toHaveBeenCalledWith(THEIR_PUBKEY, {
      ttlSeconds: 3600,
    })
  })

  it("applies group disappearing message TTL from group metadata updates", async () => {
    const groupId = "group-1"

    attachSessionEventListener()
    await flushPromises()

    expect(sessionManager.onEvent).toHaveBeenCalledTimes(1)
    expect(capturedCallback).toBeTruthy()

    capturedCallback?.(
      {
        id: "meta-1",
        kind: 40,
        pubkey: THEIR_PUBKEY,
        content: JSON.stringify({
          id: groupId,
          name: "My Group",
          members: [THEIR_PUBKEY, MY_PUBKEY],
          admins: [THEIR_PUBKEY],
          secret: "0".repeat(64),
          messageTtlSeconds: 3600,
        }),
        created_at: Math.floor(Date.now() / 1000),
        tags: [["l", groupId]],
      },
      THEIR_PUBKEY
    )

    await flushPromises()

    expect(useGroupsStore.getState().groups[groupId]?.messageTtlSeconds).toBe(3600)
    expect(useChatExpirationStore.getState().expirations[groupId]).toBe(3600)
    expect(sessionManager.setExpirationForGroup).toHaveBeenCalledWith(groupId, {
      ttlSeconds: 3600,
    })
  })
})
