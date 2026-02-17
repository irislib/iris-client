import { NDKEvent } from "@/lib/ndk"
import { ensureSessionManager } from "@/shared/services/PrivateChats"
import { LocalForageStorageAdapter } from "@/session/StorageAdapter"
import { useDevicesStore } from "@/stores/devices"
import { type Group, useGroupsStore } from "@/stores/groups"
import { usePrivateMessagesStore } from "@/stores/privateMessages"
import { useUserStore } from "@/stores/user"
import { ndk } from "@/utils/ndk"
import { getTag } from "@/utils/tagUtils"
import {
  GroupManager,
  GROUP_SENDER_KEY_DISTRIBUTION_KIND,
  type GroupData,
  type GroupDecryptedEvent,
  type NostrSubscribe,
  type Rumor,
} from "nostr-double-ratchet"

type GroupManagerRuntime = {
  manager: GroupManager
  ownerPubkey: string
  devicePubkey: string
}

const groupStorage = new LocalForageStorageAdapter()
let runtime: GroupManagerRuntime | null = null
let unsubscribeGroupsStore: (() => void) | null = null

function resolveOwnerPubkey(): string | null {
  const owner = useUserStore.getState().publicKey?.trim()
  return owner || null
}

function resolveDevicePubkey(): string | null {
  const device = useDevicesStore.getState().identityPubkey?.trim()
  if (device) return device
  return resolveOwnerPubkey()
}

function resolveSenderOwnerPubkey(
  event: GroupDecryptedEvent,
  ownerPubkey: string,
  devicePubkey: string
): string {
  if (event.senderOwnerPubkey) return event.senderOwnerPubkey
  if (event.senderDevicePubkey === devicePubkey) return ownerPubkey
  return event.senderDevicePubkey
}

function createNostrSubscribe(): NostrSubscribe {
  return (filter, onEvent) => {
    const sub = ndk().subscribe(filter)
    sub.on("event", (event: unknown) => {
      const raw =
        event && typeof event === "object" && "rawEvent" in event
          ? (event as { rawEvent?: () => unknown }).rawEvent?.()
          : event
      if (!raw || typeof raw !== "object") return
      onEvent(raw as any)
    })
    sub.start()
    return () => sub.stop()
  }
}

function ensurePlaceholderGroup(
  groupId: string,
  myPubkey: string,
  senderOwnerPubkey?: string
): void {
  if (!groupId) return
  const { groups, addGroup } = useGroupsStore.getState()
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

function toGroupData(group: Group): GroupData {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    picture: group.picture,
    members: group.members,
    admins: group.admins,
    createdAt: group.createdAt,
    secret: group.secret,
    accepted: group.accepted,
  }
}

function buildFallbackGroupData(
  groupId: string,
  groupMembers: string[],
  senderPubKey: string
): GroupData {
  const memberSet = new Set(groupMembers)
  memberSet.add(senderPubKey)
  return {
    id: groupId,
    name: `Group ${groupId.slice(0, 8)}`,
    members: Array.from(memberSet),
    admins: [senderPubKey],
    createdAt: Date.now(),
    accepted: true,
  }
}

async function handleDecryptedEvent(
  event: GroupDecryptedEvent,
  ownerPubkey: string,
  devicePubkey: string
): Promise<void> {
  const myPubkey = useUserStore.getState().publicKey
  if (!myPubkey) return

  const senderOwnerPubkey = resolveSenderOwnerPubkey(event, ownerPubkey, devicePubkey)
  ensurePlaceholderGroup(event.groupId, myPubkey, senderOwnerPubkey)

  await usePrivateMessagesStore.getState().upsert(event.groupId, myPubkey, {
    ...event.inner,
    ownerPubkey: senderOwnerPubkey,
  })
}

function ensureGroupManager(): GroupManager | null {
  const ownerPubkey = resolveOwnerPubkey()
  const devicePubkey = resolveDevicePubkey()
  if (!ownerPubkey || !devicePubkey) return null

  if (
    runtime &&
    runtime.ownerPubkey === ownerPubkey &&
    runtime.devicePubkey === devicePubkey
  ) {
    return runtime.manager
  }

  if (runtime) {
    runtime.manager.destroy()
    runtime = null
  }

  const manager = new GroupManager({
    ourOwnerPubkey: ownerPubkey,
    ourDevicePubkey: devicePubkey,
    storage: groupStorage,
    nostrSubscribe: createNostrSubscribe(),
    onDecryptedEvent: (event) => {
      void handleDecryptedEvent(event, ownerPubkey, devicePubkey).catch(() => {})
    },
  })

  runtime = {
    manager,
    ownerPubkey,
    devicePubkey,
  }

  return manager
}

async function upsertGroupForTransport(groupData: GroupData): Promise<void> {
  const manager = ensureGroupManager()
  if (!manager) return
  await manager.upsertGroup(groupData)
}

async function ensureGroupForTransport(
  groupId: string,
  groupMembers: string[],
  senderPubKey: string
): Promise<void> {
  const existing = useGroupsStore.getState().groups[groupId]
  if (existing) {
    await upsertGroupForTransport(toGroupData(existing))
    return
  }
  await upsertGroupForTransport(buildFallbackGroupData(groupId, groupMembers, senderPubKey))
}

function maybeDistributionGroupId(event: Rumor): string | undefined {
  if (event.kind !== GROUP_SENDER_KEY_DISTRIBUTION_KIND) return undefined
  try {
    const parsed = JSON.parse(event.content) as { groupId?: unknown }
    if (typeof parsed.groupId === "string" && parsed.groupId) {
      return parsed.groupId
    }
  } catch {
    // ignore
  }
  return undefined
}

export async function ingestGroupSessionEvent(
  event: Rumor,
  senderOwnerPubkey: string,
  senderDevicePubkey?: string
): Promise<void> {
  const myPubkey = useUserStore.getState().publicKey
  if (!myPubkey) return

  const groupId = maybeDistributionGroupId(event) || getTag("l", event.tags)
  if (!groupId) return

  ensurePlaceholderGroup(groupId, myPubkey, senderOwnerPubkey)
  const group = useGroupsStore.getState().groups[groupId]
  if (!group) return

  await upsertGroupForTransport(toGroupData(group))

  const manager = ensureGroupManager()
  if (!manager) return

  await manager.handleIncomingSessionEvent(
    event,
    senderOwnerPubkey,
    senderDevicePubkey || event.pubkey
  )
}

export async function sendGroupEventViaTransport(options: {
  groupId: string
  groupMembers: string[]
  senderPubKey: string
  kind: number
  content: string
  tags?: string[][]
}): Promise<{ inner: Rumor; outerEventId?: string }> {
  const { groupId, groupMembers, senderPubKey, kind, content, tags } = options
  const manager = ensureGroupManager()
  if (!manager) {
    throw new Error("GroupManager is not ready")
  }

  await ensureGroupForTransport(groupId, groupMembers, senderPubKey)

  const sessionManager = await ensureSessionManager(senderPubKey)
  let publishedOuterEventId: string | undefined

  const sent = await manager.sendEvent(
    groupId,
    {
      kind,
      content,
      tags,
    },
    {
      sendPairwise: async (recipientOwnerPubkey, rumor) => {
        await sessionManager.sendEvent(recipientOwnerPubkey, rumor)
      },
      publishOuter: async (outer) => {
        const event = new NDKEvent(ndk(), outer)
        await event.publish()
        publishedOuterEventId = event.id
      },
    }
  )

  return {
    inner: sent.inner,
    outerEventId: publishedOuterEventId,
  }
}

export async function rotateGroupSenderKey(options: {
  groupId: string
  groupMembers: string[]
  senderPubKey: string
}): Promise<void> {
  const { groupId, groupMembers, senderPubKey } = options
  const manager = ensureGroupManager()
  if (!manager) return

  await ensureGroupForTransport(groupId, groupMembers, senderPubKey)
  const sessionManager = await ensureSessionManager(senderPubKey)

  await manager.rotateSenderKey(groupId, {
    sendPairwise: async (recipientOwnerPubkey, rumor) => {
      await sessionManager.sendEvent(recipientOwnerPubkey, rumor)
    },
  })
}

export function attachGroupTransportListener(): void {
  if (unsubscribeGroupsStore) return

  const manager = ensureGroupManager()
  if (manager) {
    const groups = useGroupsStore.getState().groups
    for (const group of Object.values(groups)) {
      void manager.upsertGroup(toGroupData(group)).catch(() => {})
    }
  }

  unsubscribeGroupsStore = useGroupsStore.subscribe((state, prev) => {
    const nextGroups = state.groups
    const prevGroups = prev.groups

    const activeManager = ensureGroupManager()
    if (!activeManager) return

    for (const group of Object.values(nextGroups)) {
      void activeManager.upsertGroup(toGroupData(group)).catch(() => {})
    }

    for (const groupId of Object.keys(prevGroups)) {
      if (!nextGroups[groupId]) {
        activeManager.removeGroup(groupId)
      }
    }
  })
}

export function cleanupGroupTransportListener(): void {
  unsubscribeGroupsStore?.()
  unsubscribeGroupsStore = null

  if (runtime) {
    runtime.manager.destroy()
    runtime = null
  }
}
