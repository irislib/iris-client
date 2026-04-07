import {ensureSessionManager, getNdrRuntime} from "@/shared/services/PrivateChats"
import {useGroupsStore, type Group} from "@/stores/groups"
import {type GroupData, type Rumor} from "nostr-double-ratchet"

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

async function upsertGroupIntoRuntime(
  groupId: string,
  groupMembers: string[],
  senderPubKey: string
): Promise<void> {
  const runtime = getNdrRuntime()
  const existing = useGroupsStore.getState().groups[groupId]
  const groupData = existing
    ? toGroupData(existing)
    : buildFallbackGroupData(groupId, groupMembers, senderPubKey)
  await runtime.upsertGroup(groupData)
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
  await ensureSessionManager(senderPubKey)
  await upsertGroupIntoRuntime(groupId, groupMembers, senderPubKey)

  const sent = await getNdrRuntime().sendGroupEvent(
    groupId,
    {
      kind,
      content,
      tags,
    },
    {}
  )

  return {
    inner: sent.inner,
    outerEventId: sent.outer.id,
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
  await ensureSessionManager(senderPubKey)

  const created = await getNdrRuntime().createGroup(name, memberOwnerPubkeys, {
    fanoutMetadata: fanoutMetadata ?? true,
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
  const sessionManager = await ensureSessionManager(senderPubKey)
  await upsertGroupIntoRuntime(groupId, groupMembers, senderPubKey)

  const groupManager = await getNdrRuntime().waitForGroupManager(senderPubKey)
  await groupManager.rotateSenderKey(groupId, {
    sendPairwise: async (recipientOwnerPubkey: string, rumor: Rumor) => {
      await sessionManager.sendEvent(recipientOwnerPubkey, rumor)
    },
  })
}
