import {NDKEvent, NDKSubscriptionCacheUsage} from "@/lib/ndk"
import {ensureSessionManager} from "@/shared/services/PrivateChats"
import {LocalForageStorageAdapter} from "@/session/StorageAdapter"
import {useDevicesStore} from "@/stores/devices"
import {type Group, useGroupsStore} from "@/stores/groups"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useTypingStore} from "@/stores/typingIndicators"
import {useUserStore} from "@/stores/user"
import {ndk} from "@/utils/ndk"
import {getTag} from "@/utils/tagUtils"
import type {VerifiedEvent} from "nostr-tools"
import {
  GroupManager,
  GROUP_SENDER_KEY_DISTRIBUTION_KIND,
  getMillisecondTimestamp,
  isTyping,
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
const GROUP_OUTER_BACKFILL_LOOKBACK_SECONDS = 3600
const GROUP_OUTER_BACKFILL_RETRY_DELAYS_MS = [0, 500, 1500]
const GROUP_OUTER_BACKFILL_DEBOUNCE_MS = 1500
const recentGroupOuterBackfillAt = new Map<string, number>()
const recentFetchedGroupOuterEventIds = new Map<string, number>()
const RECENT_GROUP_OUTER_EVENT_TTL_MS = 5 * 60 * 1000

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

function isVerifiedNostrEvent(value: unknown): value is VerifiedEvent {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<VerifiedEvent>
  return (
    typeof candidate.id === "string" &&
    typeof candidate.pubkey === "string" &&
    typeof candidate.sig === "string" &&
    typeof candidate.created_at === "number" &&
    typeof candidate.kind === "number" &&
    typeof candidate.content === "string" &&
    Array.isArray(candidate.tags)
  )
}

function createNostrSubscribe(): NostrSubscribe {
  return (filter, onEvent) => {
    const sub = ndk().subscribe(filter, {
      closeOnEose: false,
      cacheUsage: NDKSubscriptionCacheUsage.PARALLEL,
    })
    sub.on("event", (event: unknown) => {
      const raw =
        event && typeof event === "object" && "rawEvent" in event
          ? (event as {rawEvent?: () => unknown}).rawEvent?.()
          : event
      if (!isVerifiedNostrEvent(raw)) return
      onEvent(raw)
    })
    sub.start()
    return () => sub.stop()
  }
}

function parseSenderEventPubkey(event: Rumor): string | null {
  if (event.kind !== GROUP_SENDER_KEY_DISTRIBUTION_KIND) return null
  try {
    const parsed = JSON.parse(event.content) as {senderEventPubkey?: unknown}
    const senderEventPubkey = parsed.senderEventPubkey
    if (
      typeof senderEventPubkey === "string" &&
      /^[0-9a-f]{64}$/i.test(senderEventPubkey)
    ) {
      return senderEventPubkey.toLowerCase()
    }
  } catch {
    // ignore malformed distribution payloads
  }
  return null
}

function parseOuterMessageNumber(content: string): number {
  try {
    const binary = atob(content)
    if (binary.length < 8) return 0
    return (
      ((binary.charCodeAt(4) & 0xff) << 24) |
      ((binary.charCodeAt(5) & 0xff) << 16) |
      ((binary.charCodeAt(6) & 0xff) << 8) |
      (binary.charCodeAt(7) & 0xff)
    ) >>> 0
  } catch {
    return 0
  }
}

function pruneRecentFetchedGroupOuterEventIds(now: number): void {
  for (const [eventId, seenAt] of recentFetchedGroupOuterEventIds.entries()) {
    if (now - seenAt > RECENT_GROUP_OUTER_EVENT_TTL_MS) {
      recentFetchedGroupOuterEventIds.delete(eventId)
    }
  }
}

async function backfillRecentGroupOuterEvents(
  manager: GroupManager,
  senderEventPubkeys: string[]
): Promise<void> {
  const now = Date.now()
  const authors = Array.from(
    new Set(
      senderEventPubkeys.filter((pubkey) => {
        if (!pubkey) return false
        const lastBackfillAt = recentGroupOuterBackfillAt.get(pubkey) || 0
        if (now - lastBackfillAt < GROUP_OUTER_BACKFILL_DEBOUNCE_MS) {
          return false
        }
        recentGroupOuterBackfillAt.set(pubkey, now)
        return true
      })
    )
  )
  if (authors.length === 0) return

  for (const delayMs of GROUP_OUTER_BACKFILL_RETRY_DELAYS_MS) {
    setTimeout(() => {
      void (async () => {
        const events = await ndk().fetchEvents(
          {
            kinds: [1060 as any],
            authors,
            since: Math.max(
              0,
              Math.floor(Date.now() / 1000) - GROUP_OUTER_BACKFILL_LOOKBACK_SECONDS
            ),
          },
          {
            cacheUsage: NDKSubscriptionCacheUsage.PARALLEL,
          }
        )

        const attemptNow = Date.now()
        pruneRecentFetchedGroupOuterEventIds(attemptNow)

        const fetched = Array.from(events)
          .map((event) => {
            const raw =
              event && typeof event === "object" && "rawEvent" in event
                ? (event as {rawEvent?: () => unknown}).rawEvent?.()
                : event
            return isVerifiedNostrEvent(raw) ? raw : null
          })
          .filter((event): event is VerifiedEvent => event !== null)
          .sort((a, b) => {
            if (a.pubkey !== b.pubkey) return a.pubkey.localeCompare(b.pubkey)
            const aNumber = parseOuterMessageNumber(a.content)
            const bNumber = parseOuterMessageNumber(b.content)
            if (aNumber !== bNumber) return aNumber - bNumber
            if (a.created_at !== b.created_at) return a.created_at - b.created_at
            return a.id.localeCompare(b.id)
          })

        for (const outer of fetched) {
          if (recentFetchedGroupOuterEventIds.has(outer.id)) continue
          recentFetchedGroupOuterEventIds.set(outer.id, attemptNow)
          await manager.handleOuterEvent(outer).catch(() => {})
        }
      })().catch(() => {})
    }, delayMs)
  }
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

  if (isTyping(event.inner)) {
    if (senderOwnerPubkey !== myPubkey) {
      useTypingStore
        .getState()
        .setRemoteTyping(event.groupId, getMillisecondTimestamp(event.inner))
    }
    return
  }

  useTypingStore
    .getState()
    .clearRemoteTyping(event.groupId, getMillisecondTimestamp(event.inner))

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
  await upsertGroupForTransport(
    buildFallbackGroupData(groupId, groupMembers, senderPubKey)
  )
}

function maybeDistributionGroupId(event: Rumor): string | undefined {
  if (event.kind !== GROUP_SENDER_KEY_DISTRIBUTION_KIND) return undefined
  try {
    const parsed = JSON.parse(event.content) as {groupId?: unknown}
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

  const senderEventPubkey = parseSenderEventPubkey(event)
  await manager.handleIncomingSessionEvent(
    event,
    senderOwnerPubkey,
    senderDevicePubkey || event.pubkey
  )
  if (senderEventPubkey) {
    await backfillRecentGroupOuterEvents(manager, [senderEventPubkey])
  }
}

export async function sendGroupEventViaTransport(options: {
  groupId: string
  groupMembers: string[]
  senderPubKey: string
  kind: number
  content: string
  tags?: string[][]
}): Promise<{inner: Rumor; outerEventId?: string}> {
  const {groupId, groupMembers, senderPubKey, kind, content, tags} = options
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

export async function createGroupViaTransport(options: {
  name: string
  memberOwnerPubkeys: string[]
  senderPubKey: string
  fanoutMetadata?: boolean
  nowMs?: number
}): Promise<GroupData> {
  const {name, memberOwnerPubkeys, senderPubKey, fanoutMetadata, nowMs} = options
  const manager = ensureGroupManager()
  if (!manager) {
    throw new Error("GroupManager is not ready")
  }

  const shouldFanoutMetadata = fanoutMetadata ?? true
  const sessionManager = shouldFanoutMetadata
    ? await ensureSessionManager(senderPubKey)
    : undefined

  const created = await manager.createGroup(name, memberOwnerPubkeys, {
    fanoutMetadata: shouldFanoutMetadata,
    ...(shouldFanoutMetadata
      ? {
          sendPairwise: async (recipientOwnerPubkey, rumor) => {
            await sessionManager!.sendEvent(recipientOwnerPubkey, rumor)
          },
        }
      : {}),
    ...(typeof nowMs === "number" ? {nowMs} : {}),
  })

  return created.group
}

export async function rotateGroupSenderKey(options: {
  groupId: string
  groupMembers: string[]
  senderPubKey: string
}): Promise<void> {
  const {groupId, groupMembers, senderPubKey} = options
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
