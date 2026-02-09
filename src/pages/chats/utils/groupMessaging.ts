import {hexToBytes} from "@noble/hashes/utils"
import {getEventHash} from "nostr-tools"

import {ensureSessionManager} from "@/shared/services/PrivateChats"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useGroupSenderKeysStore} from "@/stores/groupSenderKeys"
import {useChatExpirationStore} from "@/stores/chatExpiration"
import {NDKEvent} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"
import {
  OneToManyChannel,
  SenderKeyState,
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

/**
 * Sends an event to a group.
 *
 * - Group metadata/control events (eg kind 40) are delivered to members via 1:1 double-ratchet sessions.
 * - Group chat events are published once using sender-key one-to-many encryption (nostr-double-ratchet v0.0.56).
 */
async function sendGroupEventImpl(options: SendGroupEventOptions): Promise<Rumor> {
  const {groupId, groupMembers, senderPubKey, content, kind, extraTags = []} = options
  const now = Date.now()
  const event: Rumor = {
    content,
    kind,
    created_at: Math.floor(now / 1000),
    tags: [["l", groupId], ["ms", String(now)], ...extraTags],
    pubkey: senderPubKey,
    id: "",
  }

  // Apply group disappearing-messages expiration to normal chat events (not metadata/control).
  if (kind !== GROUP_METADATA_KIND && kind !== GROUP_SENDER_KEY_DISTRIBUTION_KIND) {
    const ttlSeconds = useChatExpirationStore.getState().expirations[groupId]
    if (typeof ttlSeconds === "number" && ttlSeconds > 0) {
      const expiresAtSeconds = resolveExpirationSeconds({ttlSeconds}, event.created_at)
      if (expiresAtSeconds !== undefined) {
        upsertExpirationTag(event.tags, expiresAtSeconds)
      }
    }
  }

  event.id = getEventHash(event)

  // Add to local store immediately for instant UI feedback
  await usePrivateMessagesStore
    .getState()
    .upsert(groupId, senderPubKey, {...event, ownerPubkey: senderPubKey})

  const sessionManager = await ensureSessionManager(senderPubKey)

  // Group metadata (creation / updates) must be delivered privately to members.
  if (kind === GROUP_METADATA_KIND) {
    Promise.all(
      groupMembers.map((memberPubKey) => sessionManager.sendEvent(memberPubKey, event))
    ).catch(console.error)
    return event
  }

  // Sender-key one-to-many publish (outer event).
  const senderKeysStore = useGroupSenderKeysStore.getState()
  const mySender = senderKeysStore.ensureMySender(groupId)

  const senderEventSecretKeyBytes = hexToBytes(mySender.senderEventSecretKey)
  const senderKeyState = SenderKeyState.fromJSON(mySender.state)

  // Distribute the sender key to group members (best-effort) before advancing it.
  if (!mySender.distributionSentAt) {
    const stateJson = senderKeyState.toJSON()
    const dist = {
      groupId,
      keyId: stateJson.keyId,
      chainKey: stateJson.chainKey,
      iteration: stateJson.iteration,
      createdAt: Math.floor(now / 1000),
      senderEventPubkey: mySender.senderEventPubkey,
    }

    const distEvent: Rumor = {
      content: JSON.stringify(dist),
      kind: GROUP_SENDER_KEY_DISTRIBUTION_KIND,
      created_at: Math.floor(now / 1000),
      tags: [
        ["l", groupId],
        ["ms", String(now)],
      ],
      pubkey: senderPubKey,
      id: "",
    }
    distEvent.id = getEventHash(distEvent)

    // Fire-and-forget; sessionManager already persists ratchet state before network I/O.
    Promise.all(
      groupMembers.map((memberPubKey) =>
        sessionManager.sendEvent(memberPubKey, distEvent)
      )
    ).catch(console.error)

    senderKeysStore.markMyDistributionSent(groupId, dist.createdAt)
  }

  const channel = OneToManyChannel.default()

  // Encrypt inner rumor JSON and build the signed outer event.
  //
  // Persist sender key state before network I/O to avoid key reuse on crash/reload.
  const outer = channel.encryptToOuterEvent(
    senderEventSecretKeyBytes,
    senderKeyState,
    JSON.stringify(event),
    event.created_at
  )
  senderKeysStore.updateMySenderState(groupId, senderKeyState.toJSON())

  // Publish in the background; update local UI status when done.
  void (async () => {
    try {
      const ndkInstance = ndk()
      const e = new NDKEvent(ndkInstance, outer)
      await e.publish()

      await usePrivateMessagesStore.getState().updateMessage(groupId, event.id, {
        sentToRelays: true,
        nostrEventId: e.id,
      })
    } catch (err) {
      console.error("Failed to publish group sender-key message:", err)
    }
  })()

  return event
}

export function sendGroupEvent(options: SendGroupEventOptions): Promise<Rumor> {
  // Sender-key state must advance monotonically; serialize group sends to avoid key reuse.
  if (options.kind === GROUP_METADATA_KIND) {
    return sendGroupEventImpl(options)
  }

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
