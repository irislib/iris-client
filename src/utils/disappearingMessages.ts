import {buildGroupMetadataContent, GROUP_METADATA_KIND} from "nostr-double-ratchet"

import {getSessionManager} from "@/shared/services/PrivateChats"
import {useChatExpirationStore} from "@/stores/chatExpiration"
import {useGroupsStore} from "@/stores/groups"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useUserStore} from "@/stores/user"
import {sendGroupEvent} from "@/pages/chats/utils/groupMessaging"

const normalizeTtlSeconds = (ttlSeconds: number | null): number | null => {
  if (ttlSeconds === null) return null
  if (typeof ttlSeconds !== "number" || !Number.isFinite(ttlSeconds)) return null
  const floored = Math.floor(ttlSeconds)
  return floored > 0 ? floored : null
}

export async function setDmDisappearingMessages(
  peerPubkey: string,
  messageTtlSeconds: number | null
): Promise<void> {
  if (!peerPubkey) return

  const normalizedTtl = normalizeTtlSeconds(messageTtlSeconds)

  useChatExpirationStore.getState().setExpiration(peerPubkey, normalizedTtl)

  const sessionManager = getSessionManager()
  const myPubKey = useUserStore.getState().publicKey
  if (!myPubKey) return
  if (!sessionManager) return

  // Use the library helper so the payload/kind/expiration rules stay in sync.
  const sent = await sessionManager.setChatSettingsForPeer(peerPubkey, normalizedTtl)

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
  if (!group.admins?.includes(myPubKey)) return

  const normalizedTtl = normalizeTtlSeconds(messageTtlSeconds)

  useGroupsStore.getState().updateGroup(groupId, {messageTtlSeconds: normalizedTtl})
  useChatExpirationStore.getState().setExpiration(groupId, normalizedTtl)

  const sessionManager = getSessionManager()
  if (sessionManager) {
    await sessionManager
      .setExpirationForGroup(groupId, normalizedTtl ? {ttlSeconds: normalizedTtl} : null)
      .catch(() => {})
  }

  // Publish group metadata update so all members converge on the same setting.
  const base = JSON.parse(buildGroupMetadataContent(group)) as Record<string, unknown>
  base.messageTtlSeconds = normalizedTtl

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
