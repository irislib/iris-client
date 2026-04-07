import {useDevicesStore} from "@/stores/devices"
import {useGroupsStore} from "@/stores/groups"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useTypingStore} from "@/stores/typingIndicators"
import {useUserStore} from "@/stores/user"
import {getNdrRuntime} from "@/shared/services/PrivateChats"
import {
  getMillisecondTimestamp,
  isTyping,
  type GroupDecryptedEvent,
} from "nostr-double-ratchet"

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

  ensurePlaceholderGroup(event.groupId, publicKey, senderOwnerPubkey)

  if (isTyping(event.inner)) {
    if (senderOwnerPubkey !== publicKey) {
      useTypingStore
        .getState()
        .setRemoteTyping(event.groupId, getMillisecondTimestamp(event.inner))
    }
    return
  }

  useTypingStore
    .getState()
    .clearRemoteTyping(event.groupId, getMillisecondTimestamp(event.inner))

  await usePrivateMessagesStore.getState().upsert(event.groupId, publicKey, {
    ...event.inner,
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
    void runtime.syncGroups(Object.values(state.groups)).catch(() => {})
  })

  if (Object.keys(useGroupsStore.getState().groups).length > 0) {
    void syncGroupsToRuntime().catch(() => {})
  }
}
