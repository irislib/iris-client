import {SocialGraph} from "nostr-social-graph"

// Aggregate snapshots can assign several numeric IDs to the same public key.
// Resolve lists by public identity before traversing, then allocate fresh IDs.
// Otherwise a follow or mute can point at an inaccessible alias of its owner.
export async function projectSocialGraph(
  source: SocialGraph,
  root: string,
  ownerDistance: number
) {
  const original = source.getInternalData()
  type List = {targets: string[]; timestamp: number; conflict?: boolean}
  const canonicalLists = (
    lists: Map<number, Set<number>>,
    timestamps: Map<number, number>,
    mergeTiedMutes = false
  ) => {
    const canonical = new Map<string, List>()
    for (const id of new Set([...lists.keys(), ...timestamps.keys()])) {
      const owner = original.str(id)
      const list = {
        targets: [...new Set([...(lists.get(id) ?? [])].map(original.str))].sort(),
        timestamp: timestamps.get(id) ?? 0,
      }
      const previous = canonical.get(owner)
      if (!previous || list.timestamp > previous.timestamp) canonical.set(owner, list)
      else if (
        list.timestamp === previous.timestamp &&
        JSON.stringify(list.targets) !== JSON.stringify(previous.targets)
      ) {
        if (mergeTiedMutes) {
          // Aggregate data cannot establish which equally recent mute list is
          // authoritative. Preserve every mute instead of dropping protection.
          previous.targets = [...new Set([...previous.targets, ...list.targets])].sort()
        } else previous.conflict = true
      }
    }
    if ([...canonical.values()].some((list) => list.conflict)) {
      throw new Error("Snapshot contains conflicting latest follow lists")
    }
    return canonical
  }
  const follows = canonicalLists(original.followedByUser, original.followListCreatedAt)
  const mutes = canonicalLists(original.mutedByUser, original.muteListCreatedAt, true)
  const projected = new SocialGraph(root)
  const data = projected.getInternalData()
  const copy = (
    owner: string,
    list: List | undefined,
    forward: Map<number, Set<number>>,
    reverse: Map<number, Set<number>>,
    timestamps: Map<number, number>
  ) => {
    if (!list) return
    const ownerId = data.ids.id(owner)
    const targets = new Set(list.targets.map((target) => data.ids.id(target)))
    forward.set(ownerId, targets)
    timestamps.set(ownerId, list.timestamp)
    for (const target of targets) {
      const owners = reverse.get(target) ?? new Set<number>()
      owners.add(ownerId)
      reverse.set(target, owners)
    }
  }
  const visited = new Set([root])
  let frontier = [root]
  for (let distance = 0; distance <= ownerDistance; distance++) {
    const next: string[] = []
    for (const owner of frontier.sort()) {
      const followList = follows.get(owner)
      copy(
        owner,
        followList,
        data.followedByUser,
        data.followersByUser,
        data.followListCreatedAt
      )
      copy(
        owner,
        mutes.get(owner),
        data.mutedByUser,
        data.userMutedBy,
        data.muteListCreatedAt
      )
      for (const target of followList?.targets ?? []) {
        if (!visited.has(target)) {
          visited.add(target)
          next.push(target)
        }
      }
    }
    frontier = next
  }
  await projected.recalculateFollowDistances(1000, 100000, () => {})
  return projected
}
