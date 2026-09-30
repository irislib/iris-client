import {ensureNdrRuntime, getNdrRuntime} from "@/shared/services/PrivateChats"
import {useGroupsStore, isGroupMember, type Group} from "@/stores/groups"
import {buildGroupRosterFactEvent, type GroupData, type Rumor} from "nostr-double-ratchet"
import {getEventHash} from "nostr-tools"
import {createGroupRumor} from "./groupRumor"

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

function currentGroup(groupId: string, senderPubKey: string): Group {
  const group = useGroupsStore.getState().groups[groupId]
  if (!isGroupMember(group, senderPubKey))
    throw new Error("You’re no longer a member of this group.")
  return group
}

async function upsertGroupIntoRuntime(
  groupId: string,
  senderPubKey: string
): Promise<void> {
  await getNdrRuntime().upsertGroup(toGroupData(currentGroup(groupId, senderPubKey)))
  currentGroup(groupId, senderPubKey)
}

export async function sendGroupEventViaTransport(options: {
  groupId: string
  groupMembers: string[]
  senderPubKey: string
  kind: number
  content: string
  tags?: string[][]
}): Promise<{inner: Rumor; outerEventId?: string}> {
  const {groupId, senderPubKey, kind, content, tags} = options
  currentGroup(groupId, senderPubKey)
  await ensureNdrRuntime(senderPubKey)
  await upsertGroupIntoRuntime(groupId, senderPubKey)

  const inner = createGroupRumor(groupId, senderPubKey, {kind, content, tags})
  const sent = await getNdrRuntime().sendGroupEvent(
    groupId,
    {
      kind,
      content: JSON.stringify(inner),
      tags: inner.tags,
    },
    {}
  )

  return {
    inner,
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
  await ensureNdrRuntime(senderPubKey)

  const created = await getNdrRuntime().createGroup(name, memberOwnerPubkeys, {
    fanoutMetadata: fanoutMetadata ?? true,
    ...(typeof nowMs === "number" ? {nowMs} : {}),
  })

  return created.group
}

export async function publishGroupRosterViaTransport(options: {
  group: Group
  senderPubKey: string
  recipients?: string[]
}): Promise<Rumor> {
  const {group, senderPubKey} = options
  const recipients = Array.from(new Set(options.recipients ?? group.members))
  await ensureNdrRuntime(senderPubKey)

  const runtime = getNdrRuntime()
  await runtime.upsertGroup(toGroupData(group))

  const nowSeconds = Math.floor(Date.now() / 1000)
  const revision = Math.max((group.rosterRevision ?? 0) + 1, Date.now())
  const roster: Rumor = {
    ...buildGroupRosterFactEvent(group, {
      signerPubkey: senderPubKey,
      revision,
      createdBy: group.admins[0] ?? senderPubKey,
      updatedAt: nowSeconds,
      eventCreatedAt: nowSeconds,
      protocol: "sender_key_v1",
    }),
    id: "",
  }
  roster.id = getEventHash(roster)

  await Promise.all(
    recipients.map((recipient) => {
      const recipientRoster = {
        ...roster,
        tags: [...roster.tags, ["p", recipient]],
      }
      recipientRoster.id = getEventHash(recipientRoster)
      return runtime.sendEvent(recipient, recipientRoster, senderPubKey)
    })
  )

  useGroupsStore.getState().updateGroup(group.id, {rosterRevision: revision})
  return roster
}

export async function rotateGroupSenderKey(options: {
  groupId: string
  groupMembers: string[]
  senderPubKey: string
}): Promise<void> {
  const {groupId, senderPubKey} = options
  currentGroup(groupId, senderPubKey)
  await ensureNdrRuntime(senderPubKey)
  await upsertGroupIntoRuntime(groupId, senderPubKey)

  const groupManager = await getNdrRuntime().waitForGroupManager(senderPubKey)
  await groupManager.rotateSenderKey(groupId, {
    sendPairwise: async (recipientOwnerPubkey: string, rumor: Rumor) => {
      await getNdrRuntime().sendEvent(recipientOwnerPubkey, rumor, senderPubKey)
    },
  })
}
