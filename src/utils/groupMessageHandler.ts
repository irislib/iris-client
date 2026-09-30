import {useDevicesStore} from "@/stores/devices"
import {useGroupsStore} from "@/stores/groups"
import {useChatExpirationStore} from "@/stores/chatExpiration"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useTypingStore} from "@/stores/typingIndicators"
import {useUserStore} from "@/stores/user"
import {getNdrRuntime, cancelGroupPublications} from "@/shared/services/PrivateChats"
import {
  CHAT_SETTINGS_KIND,
  getMillisecondTimestamp,
  isGroupRosterFactEvent,
  isTyping,
  parseGroupRosterFactRumor,
  type GroupDecryptedEvent,
  type GroupRosterFactRumor,
} from "nostr-double-ratchet"
import {unwrapGroupRumor} from "./groupRumor"
import {parseChatSettingsMessage} from "./chatSettings"

let unsubscribeGroupEvents: (() => void) | null = null
let unsubscribeGroupsStore: (() => void) | null = null

function resolveSenderOwnerPubkey(
  event: GroupDecryptedEvent,
  ownerPubkey: string,
  devicePubkey: string
): string {
  const eventWithOrigin = event as GroupDecryptedEvent & {
    origin?: string
    isSelf?: boolean
  }

  if (typeof eventWithOrigin.isSelf === "boolean") {
    return eventWithOrigin.isSelf
      ? ownerPubkey
      : event.senderOwnerPubkey || event.senderDevicePubkey
  }

  if (
    eventWithOrigin.origin === "local-device" ||
    eventWithOrigin.origin === "same-owner-other-device"
  ) {
    return ownerPubkey
  }

  if (event.senderOwnerPubkey) {
    return event.senderOwnerPubkey === ownerPubkey ? ownerPubkey : event.senderOwnerPubkey
  }

  if (event.senderDevicePubkey === devicePubkey) return ownerPubkey
  return event.senderDevicePubkey
}

function ensurePlaceholderGroup(
  groupId: string,
  myPubkey: string,
  senderOwnerPubkey?: string
): void {
  if (!groupId) return
  const {groups, addGroup} = useGroupsStore.getState()
  if (groups[groupId]) return

  const members = [myPubkey]
  if (senderOwnerPubkey && senderOwnerPubkey !== myPubkey) {
    members.push(senderOwnerPubkey)
  }

  addGroup({
    id: groupId,
    name: `Group ${groupId.slice(0, 8)}`,
    description: "",
    picture: "",
    members,
    admins: [members[0]],
    createdAt: Date.now(),
    accepted: true,
  })
}

async function handleGroupEvent(event: GroupDecryptedEvent): Promise<void> {
  const {publicKey} = useUserStore.getState()
  if (!publicKey) return

  const {identityPubkey} = useDevicesStore.getState()
  const devicePubkey = identityPubkey?.trim() || publicKey
  const senderOwnerPubkey = resolveSenderOwnerPubkey(event, publicKey, devicePubkey)

  if (isGroupRosterFactEvent(event.inner)) {
    const fact = parseGroupRosterFactRumor(event.inner as GroupRosterFactRumor)
    const {groups, addGroup} = useGroupsStore.getState()
    const existing = groups[fact.groupId]

    if (existing?.rosterRevision !== undefined && fact.revision < existing.rosterRevision)
      return
    // Keep the last roster and history so removal cannot recreate a writable placeholder.
    if (!fact.group.members.includes(publicKey)) {
      cancelGroupPublications(fact.groupId)
      useTypingStore.getState().clearRemoteTyping(fact.groupId)
      if (!existing) return
    }

    addGroup({
      ...fact.group,
      createdAt: fact.group.createdAt * 1000,
      ...(existing?.secret ? {secret: existing.secret} : {}),
      accepted: existing?.accepted ?? fact.signerPubkey === publicKey,
      messageTtlSeconds: existing?.messageTtlSeconds ?? null,
      rosterRevision: fact.revision,
    })
    return
  }

  const inner = unwrapGroupRumor(
    event.inner,
    event.groupId,
    senderOwnerPubkey,
    event.senderDevicePubkey
  )
  if (!inner) return

  ensurePlaceholderGroup(event.groupId, publicKey, senderOwnerPubkey)

  if (inner.kind === CHAT_SETTINGS_KIND) {
    const group = useGroupsStore.getState().groups[event.groupId]
    const settings = parseChatSettingsMessage(inner.content)
    if (!group?.admins.includes(senderOwnerPubkey) || !settings) return

    useGroupsStore.getState().updateGroup(event.groupId, {
      messageTtlSeconds: settings.messageTtlSeconds,
    })
    useChatExpirationStore
      .getState()
      .setExpiration(event.groupId, settings.messageTtlSeconds)
    await getNdrRuntime().setExpirationForGroup(
      event.groupId,
      settings.messageTtlSeconds ? {ttlSeconds: settings.messageTtlSeconds} : null
    )
    return
  }

  if (isTyping(inner)) {
    if (senderOwnerPubkey !== publicKey) {
      useTypingStore
        .getState()
        .setRemoteTyping(event.groupId, getMillisecondTimestamp(inner))
    }
    return
  }

  useTypingStore
    .getState()
    .clearRemoteTyping(event.groupId, getMillisecondTimestamp(inner))

  await usePrivateMessagesStore.getState().upsert(event.groupId, publicKey, {
    ...inner,
    ownerPubkey: senderOwnerPubkey,
  })
}

const syncGroupsToRuntime = async (): Promise<void> => {
  const runtime = getNdrRuntime()
  const groups = Object.values(useGroupsStore.getState().groups)
  await runtime.syncGroups(groups)
}

export const cleanupGroupMessageListener = (): void => {
  unsubscribeGroupEvents?.()
  unsubscribeGroupEvents = null

  unsubscribeGroupsStore?.()
  unsubscribeGroupsStore = null
}

export const attachGroupMessageListener = (): void => {
  cleanupGroupMessageListener()

  const runtime = getNdrRuntime()
  unsubscribeGroupEvents = runtime.onGroupEvent((event) => {
    void handleGroupEvent(event).catch((error) => {
      console.error("Failed to process group event:", error)
    })
  })

  unsubscribeGroupsStore = useGroupsStore.subscribe((state, prev) => {
    if (state.groups === prev.groups) return
    const owner = useUserStore.getState().publicKey
    for (const [id, group] of Object.entries(prev.groups)) {
      if (group.members.includes(owner) && !state.groups[id]?.members.includes(owner)) {
        cancelGroupPublications(id)
      }
    }
    void runtime.syncGroups(Object.values(state.groups)).catch(() => {})
  })

  if (Object.keys(useGroupsStore.getState().groups).length > 0) {
    void syncGroupsToRuntime().catch(() => {})
  }
}
