import {getEventHash} from "nostr-tools"

import {ensureSessionManager} from "@/shared/services/PrivateChats"
import {useChatExpirationStore} from "@/stores/chatExpiration"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {sendGroupEventViaTransport} from "@/utils/groupTransport"
import {
  GROUP_METADATA_KIND,
  GROUP_SENDER_KEY_DISTRIBUTION_KIND,
  resolveExpirationSeconds,
  upsertExpirationTag,
  type Rumor,
} from "nostr-double-ratchet"

interface SendGroupEventOptions {
  groupId: string
  groupMembers: string[]
  senderPubKey: string
  content: string
  kind: number
  extraTags?: string[][]
}

const senderKeySendQueue = new Map<string, Promise<unknown>>()

async function sendGroupEventImpl(options: SendGroupEventOptions): Promise<Rumor> {
  const {groupId, groupMembers, senderPubKey, content, kind, extraTags = []} = options
  const nowMs = Date.now()
  const createdAt = Math.floor(nowMs / 1000)
  const tags: string[][] = [["l", groupId], ["ms", String(nowMs)], ...extraTags]

  // Group metadata/control stays on pairwise 1:1 transport.
  if (kind === GROUP_METADATA_KIND) {
    const event: Rumor = {
      content,
      kind,
      created_at: createdAt,
      tags,
      pubkey: senderPubKey,
      id: "",
    }
    event.id = getEventHash(event)

    await usePrivateMessagesStore
      .getState()
      .upsert(groupId, senderPubKey, {...event, ownerPubkey: senderPubKey})

    const sessionManager = await ensureSessionManager(senderPubKey)
    Promise.all(
      groupMembers.map((memberPubKey) => sessionManager.sendEvent(memberPubKey, event))
    ).catch(console.error)

    return event
  }

  // Apply group disappearing-messages expiration to normal chat events.
  if (kind !== GROUP_SENDER_KEY_DISTRIBUTION_KIND) {
    const ttlSeconds = useChatExpirationStore.getState().expirations[groupId]
    if (typeof ttlSeconds === "number" && ttlSeconds > 0) {
      const expiresAtSeconds = resolveExpirationSeconds({ttlSeconds}, createdAt)
      if (expiresAtSeconds !== undefined) {
        upsertExpirationTag(tags, expiresAtSeconds)
      }
    }
  }

  const sent = await sendGroupEventViaTransport({
    groupId,
    groupMembers,
    senderPubKey,
    kind,
    content,
    tags,
  })

  await usePrivateMessagesStore.getState().upsert(groupId, senderPubKey, {
    ...sent.inner,
    ownerPubkey: senderPubKey,
    ...(sent.outerEventId ? {sentToRelays: true, nostrEventId: sent.outerEventId} : {}),
  })

  return sent.inner
}

export function sendGroupEvent(options: SendGroupEventOptions): Promise<Rumor> {
  if (options.kind === GROUP_METADATA_KIND) {
    return sendGroupEventImpl(options)
  }

  // Serialize sender-key sends per group to avoid chain-state races.
  const key = options.groupId
  const prev = senderKeySendQueue.get(key) ?? Promise.resolve()
  const next = prev.then(() => sendGroupEventImpl(options))
  const queued = next.catch(() => undefined)
  senderKeySendQueue.set(key, queued)
  queued.finally(() => {
    if (senderKeySendQueue.get(key) === queued) {
      senderKeySendQueue.delete(key)
    }
  })
  return next
}
