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
  // New API (0.0.59) we want to use.
  setChatSettingsForPeer: vi.fn().mockResolvedValue(sentSettingsRumor),
}

vi.mock("@/shared/services/PrivateChats", () => ({
  getSessionManager: () => sessionManager,
}))

import {setDmDisappearingMessages} from "@/utils/disappearingMessages"

describe("disappearingMessages", () => {
  beforeEach(async () => {
    sessionManager.sendMessage.mockClear()
    sessionManager.setExpirationForPeer.mockClear()
    sessionManager.setChatSettingsForPeer.mockClear()

    useUserStore.setState({publicKey: MY_PUBKEY})
    useChatExpirationStore.setState({expirations: {}})
    await usePrivateMessagesStore.getState().clear()
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
})
