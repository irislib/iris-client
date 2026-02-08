import {buildGroupMetadataContent, GROUP_METADATA_KIND} from "nostr-double-ratchet"

import {getSessionManager} from "@/shared/services/PrivateChats"
import {useChatExpirationStore} from "@/stores/chatExpiration"
import {useGroupsStore} from "@/stores/groups"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useUserStore} from "@/stores/user"
import {KIND_CHAT_SETTINGS} from "@/utils/constants"
import {sendGroupEvent} from "@/pages/chats/utils/groupMessaging"

import type {ChatSettingsPayloadV1} from "@/utils/chatSettings"

const buildSettingsPayload = (messageTtlSeconds: number | null): ChatSettingsPayloadV1 => ({
  type: "chat-settings",
  v: 1,
  messageTtlSeconds,
})

export async function setDmDisappearingMessages(
  peerPubkey: string,
  messageTtlSeconds: number | null
): Promise<void> {
  if (!peerPubkey) return

  useChatExpirationStore.getState().setExpiration(peerPubkey, messageTtlSeconds)

  const sessionManager = getSessionManager()
  if (sessionManager) {
    await sessionManager
      .setExpirationForPeer(
        peerPubkey,
        messageTtlSeconds ? {ttlSeconds: messageTtlSeconds} : null
      )
      .catch(() => {})
  }

  const myPubKey = useUserStore.getState().publicKey
  if (!myPubKey) return
  if (!sessionManager) return

  const sent = await sessionManager.sendMessage(
    peerPubkey,
    JSON.stringify(buildSettingsPayload(messageTtlSeconds)),
    {
      kind: KIND_CHAT_SETTINGS,
      // Settings messages should not disappear (they describe the timer).
      expiration: null,
    }
  )

  await usePrivateMessagesStore
    .getState()
    .upsert(peerPubkey, myPubKey, {...sent, ownerPubkey: myPubKey})
}

export async function setGroupDisappearingMessages(
  groupId: string,
  messageTtlSeconds: number | null
): Promise<void> {
  if (!groupId) return

  const myPubKey = useUserStore.getState().publicKey
  if (!myPubKey) return

  const group = useGroupsStore.getState().groups[groupId]
  if (!group) return

  useGroupsStore.getState().updateGroup(groupId, {messageTtlSeconds})
  useChatExpirationStore.getState().setExpiration(groupId, messageTtlSeconds)

  const sessionManager = getSessionManager()
  if (sessionManager) {
    await sessionManager
      .setExpirationForGroup(
        groupId,
        messageTtlSeconds ? {ttlSeconds: messageTtlSeconds} : null
      )
      .catch(() => {})
  }

  // Publish group metadata update so all members converge on the same setting.
  const base = JSON.parse(buildGroupMetadataContent(group)) as Record<string, unknown>
  base.messageTtlSeconds = messageTtlSeconds

  await sendGroupEvent({
    groupId,
    groupMembers: group.members,
    senderPubKey: myPubKey,
    content: JSON.stringify(base),
    kind: GROUP_METADATA_KIND,
  })
}

export async function syncDisappearingMessagesToSessionManager(): Promise<void> {
  const sessionManager = getSessionManager()
  if (!sessionManager) return

  const expirations = useChatExpirationStore.getState().expirations
  const entries = Object.entries(expirations).filter(([, ttl]) => ttl !== undefined)

  await Promise.all(
    entries.map(async ([chatId, ttl]) => {
      const isPubkey = /^[0-9a-f]{64}$/i.test(chatId)
      const options = ttl ? {ttlSeconds: ttl} : null
      if (isPubkey) {
        await sessionManager.setExpirationForPeer(chatId, options).catch(() => {})
      } else {
        await sessionManager.setExpirationForGroup(chatId, options).catch(() => {})
      }
    })
  )
}
