import {getEventHash} from "nostr-tools"
import {getSessionManager} from "@/shared/services/PrivateChats"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {Rumor} from "nostr-double-ratchet/src"

interface SendGroupEventOptions {
  groupId: string
  groupMembers: string[]
  senderPubKey: string
  content: string
  kind: number
  extraTags?: string[][]
}

/**
 * Sends an event to all members of a group via encrypted double-ratchet sessions.
 * The event is stored locally first, then sent to each member in the background.
 */
export async function sendGroupEvent({
  groupId,
  groupMembers,
  senderPubKey,
  content,
  kind,
  extraTags = [],
}: SendGroupEventOptions): Promise<Rumor> {
  const now = Date.now()
  const event: Rumor = {
    content,
    kind,
    created_at: Math.floor(now / 1000),
    tags: [["l", groupId], ["ms", String(now)], ...extraTags],
    pubkey: senderPubKey,
    id: "",
  }
  event.id = getEventHash(event)

  // Add to local store immediately for instant UI feedback
  await usePrivateMessagesStore
    .getState()
    .upsert(groupId, senderPubKey, {...event, ownerPubkey: senderPubKey})

  // Send to all group members in background (no await - don't block caller)
  const sessionManager = getSessionManager()
  if (sessionManager) {
    Promise.all(
      groupMembers.map((memberPubKey) => sessionManager.sendEvent(memberPubKey, event))
    ).catch(console.error)
  }

  return event
}
