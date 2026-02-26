import {beforeEach, describe, expect, it, vi} from "vitest"

import {KIND_CHAT_SETTINGS} from "@/utils/constants"
import {useChatExpirationStore} from "@/stores/chatExpiration"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useUserStore} from "@/stores/user"

const MY_PUBKEY = "a".repeat(64)
const THEIR_PUBKEY = "b".repeat(64)

const sentSettingsRumor = {
  id: "settings-1",
  kind: KIND_CHAT_SETTINGS,
  pubkey: MY_PUBKEY,
  content: JSON.stringify({type: "chat-settings", v: 1, messageTtlSeconds: 3600}),
  created_at: Math.floor(Date.now() / 1000),
  tags: [["p", THEIR_PUBKEY]],
}

const sessionManager = {
  // Legacy/custom impl used sendMessage(kind=KIND_CHAT_SETTINGS); keep stub so the test can fail by assertion.
  sendMessage: vi.fn().mockResolvedValue(sentSettingsRumor),
  setExpirationForPeer: vi.fn().mockResolvedValue(undefined),
  setExpirationForGroup: vi.fn().mockResolvedValue(undefined),
  // New API (0.0.59) we want to use.
  setChatSettingsForPeer: vi.fn().mockResolvedValue(sentSettingsRumor),
}

vi.mock("@/shared/services/PrivateChats", () => ({
  getSessionManager: () => sessionManager,
}))

vi.mock("@/pages/chats/utils/groupMessaging", () => ({
  sendGroupEvent: vi.fn().mockResolvedValue({id: "group-event-1"}),
}))

vi.mock("nostr-double-ratchet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nostr-double-ratchet")>()
  return {
    ...actual,
    buildGroupMetadataContent: (group: Record<string, unknown>) =>
      JSON.stringify({name: group.name}),
  }
})

import {
  setDmDisappearingMessages,
  setGroupDisappearingMessages,
} from "@/utils/disappearingMessages"
import {useGroupsStore} from "@/stores/groups"
import {sendGroupEvent} from "@/pages/chats/utils/groupMessaging"

const mockedSendGroupEvent = vi.mocked(sendGroupEvent)

describe("disappearingMessages", () => {
  beforeEach(async () => {
    sessionManager.sendMessage.mockClear()
    sessionManager.setExpirationForPeer.mockClear()
    sessionManager.setExpirationForGroup.mockClear()
    sessionManager.setChatSettingsForPeer.mockClear()
    mockedSendGroupEvent.mockClear()

    useUserStore.setState({publicKey: MY_PUBKEY})
    useChatExpirationStore.setState({expirations: {}})
    useGroupsStore.setState({groups: {}})
    await usePrivateMessagesStore.getState().clear()
  })

  it("normalizes TTL for DM disappearing messages", async () => {
    await setDmDisappearingMessages(THEIR_PUBKEY, 3600.7)
    expect(sessionManager.setChatSettingsForPeer).toHaveBeenCalledWith(THEIR_PUBKEY, 3600)
    expect(useChatExpirationStore.getState().expirations[THEIR_PUBKEY]).toBe(3600)
  })

  it("normalizes negative TTL to null for DMs", async () => {
    await setDmDisappearingMessages(THEIR_PUBKEY, -1)
    expect(sessionManager.setChatSettingsForPeer).toHaveBeenCalledWith(THEIR_PUBKEY, null)
    expect(useChatExpirationStore.getState().expirations[THEIR_PUBKEY]).toBeNull()
  })

  it("uses nostr-double-ratchet chat-settings helper for request sending", async () => {
    await setDmDisappearingMessages(THEIR_PUBKEY, 3600)

    expect(sessionManager.setChatSettingsForPeer).toHaveBeenCalledWith(THEIR_PUBKEY, 3600)
    expect(sessionManager.sendMessage).not.toHaveBeenCalled()
    expect(sessionManager.setExpirationForPeer).not.toHaveBeenCalled()

    expect(useChatExpirationStore.getState().expirations[THEIR_PUBKEY]).toBe(3600)

    const map = usePrivateMessagesStore.getState().events.get(THEIR_PUBKEY)
    expect(map?.get("settings-1")?.kind).toBe(KIND_CHAT_SETTINGS)
  })

  describe("setGroupDisappearingMessages", () => {
    const GROUP_ID = "test-group-1"

    beforeEach(() => {
      useGroupsStore.setState({
        groups: {
          [GROUP_ID]: {
            id: GROUP_ID,
            name: "Test Group",
            description: "",
            picture: "",
            members: [MY_PUBKEY],
            admins: [MY_PUBKEY],
            createdAt: Date.now(),
            messageTtlSeconds: null,
          },
        },
      })
    })

    it("normalizes TTL and updates stores", async () => {
      await setGroupDisappearingMessages(GROUP_ID, 3600.9)

      expect(useChatExpirationStore.getState().expirations[GROUP_ID]).toBe(3600)
      expect(useGroupsStore.getState().groups[GROUP_ID].messageTtlSeconds).toBe(3600)
      expect(mockedSendGroupEvent).toHaveBeenCalledWith(
        expect.objectContaining({groupId: GROUP_ID})
      )
    })

    it("normalizes negative TTL to null", async () => {
      await setGroupDisappearingMessages(GROUP_ID, -5)

      expect(useChatExpirationStore.getState().expirations[GROUP_ID]).toBeNull()
      expect(useGroupsStore.getState().groups[GROUP_ID].messageTtlSeconds).toBeNull()
    })

    it("publishes group metadata with normalized TTL", async () => {
      await setGroupDisappearingMessages(GROUP_ID, 7200)

      const call = mockedSendGroupEvent.mock.calls[0][0]
      const content = JSON.parse(call.content)
      expect(content.messageTtlSeconds).toBe(7200)
    })

    it("ignores group TTL changes from non-admin users", async () => {
      useGroupsStore.setState({
        groups: {
          [GROUP_ID]: {
            ...useGroupsStore.getState().groups[GROUP_ID],
            admins: [THEIR_PUBKEY],
            messageTtlSeconds: null,
          },
        },
      })

      await setGroupDisappearingMessages(GROUP_ID, 3600)

      expect(useGroupsStore.getState().groups[GROUP_ID].messageTtlSeconds).toBeNull()
      expect(useChatExpirationStore.getState().expirations[GROUP_ID]).toBeUndefined()
      expect(sessionManager.setExpirationForGroup).not.toHaveBeenCalled()
      expect(mockedSendGroupEvent).not.toHaveBeenCalled()
    })
  })
})
