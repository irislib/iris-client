import {sha256} from "@noble/hashes/sha2.js"
import {
  buildFactOpDraft,
  buildFactSnapshotDraft,
  chooseTrustedAuthors,
  FACT_OP_KIND,
  FACT_SNAPSHOT_KIND,
  parseFactOpEvent,
  parseFactSnapshotEvent,
  type Fact,
  type FactEventDraft,
  type NostrEvent,
} from "nostr-social-graph"
import {verifyEvent} from "nostr-tools"

export const GROUP_FACT_KIND = FACT_OP_KIND
export const GROUP_METADATA_KIND = FACT_SNAPSHOT_KIND
export const GROUP_FACT_KINDS = [GROUP_METADATA_KIND, GROUP_FACT_KIND]
export const GROUP_DISCOVERY_TAG = "iris-group"
export const DEFAULT_GROUP_POLICY: GroupPolicy = {direct: 1, secondDegree: 3}
export const MAX_GROUP_THRESHOLD = 20

export type GroupRef = {id: string; creator: string}
export type GroupPolicy = {direct: number; secondDegree: number}
export type Group = GroupRef & {
  name: string
  description: string
  policy: GroupPolicy
  eventId: string
  createdAt: number
}
export type GroupView = "creator" | "personal"
export type GroupMember = {
  pubkey: string
  joined: boolean
  eligible: boolean
  reason: string
  directVouches: number
  secondDegreeVouches: number
  /** Active signed vouches, including authors who have not joined or have left. */
  vouchers: string[]
  directVouchers: string[]
  secondDegreeVouchers: string[]
}
export type GroupMembers = {
  members: GroupMember[]
  byPubkey: Map<string, GroupMember>
  eligiblePubkeys: Set<string>
  /** Eligible root/direct accounts; membership never delegates this authority. */
  authorityPubkeys: Set<string>
  /** Positive fact evidence for this observed projection, not proof of completeness. */
  evidenceEventIds: string[]
  view: GroupView
  rootPubkey: string
  policy: GroupPolicy
  /** A traversal cap was reached; the observed trust evidence can be incomplete. */
  truncated: boolean
}

export type GroupElectorate = {
  rootPubkey: string
  policyEventId: string
  policy: GroupPolicy
  memberPubkeys: string[]
  authorityPubkeys: string[]
  evidenceEventIds: string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PUBKEY = /^[0-9a-f]{64}$/
const MAX_TAGS = 128
const MAX_TAG_LENGTH = 4096
const MAX_DIRECT_CONTACTS = 256
const MAX_FOLLOWS_SCANNED = 2048
const MAX_GRAPH_EDGES = 32768
const encoder = new TextEncoder()

function validPolicy(policy: GroupPolicy): boolean {
  return [policy.direct, policy.secondDegree].every(
    (n) => Number.isInteger(n) && n >= 1 && n <= MAX_GROUP_THRESHOLD
  )
}

function assertRef(group: GroupRef): void {
  if (!UUID.test(group.id) || !PUBKEY.test(group.creator)) {
    throw new Error("A group needs a canonical UUID and creator public key")
  }
}

export function groupAddress(group: GroupRef): string {
  assertRef(group)
  return `${GROUP_METADATA_KIND}:${group.creator}:${group.id}`
}

export function groupTags(group: GroupRef): string[][] {
  return [
    ["h", group.id],
    ["a", groupAddress(group)],
  ]
}

/** A deterministic identity subject; claims never merge distinct signing keys. */
export function memberSubject(pubkey: string): string {
  if (!PUBKEY.test(pubkey)) throw new Error("Invalid member public key")
  const bytes = sha256(encoder.encode(`iris-group-member:${pubkey}`)).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const fact = (predicate: string, ...values: string[]): Fact => ({predicate, values})

export function createGroupDraft(
  input: GroupRef & {name: string; description?: string; policy?: GroupPolicy}
): FactEventDraft {
  assertRef(input)
  const name = input.name.trim()
  const description = (input.description ?? "").trim()
  const policy = input.policy ?? DEFAULT_GROUP_POLICY
  if (!name || name.length > 80 || description.length > 2000 || !validPolicy(policy)) {
    throw new Error(
      "Use a name of 1–80 characters, description up to 2000 characters, and thresholds of 1–20"
    )
  }
  const draft = buildFactSnapshotDraft(
    input.id,
    [
      fact("type", "iris_group"),
      fact("schema", "1"),
      fact("name", name),
      fact("description", description),
      fact("creator", input.creator),
      fact("direct_threshold", String(policy.direct)),
      fact("second_degree_threshold", String(policy.secondDegree)),
    ],
    []
  )
  draft.tags.push(...groupTags(input), ["t", GROUP_DISCOVERY_TAG])
  return draft
}

function memberDraft(
  group: GroupRef,
  memberPubkey: string,
  active: boolean,
  type: "iris_group_membership" | "iris_group_vouch"
): FactEventDraft {
  assertRef(group)
  const draft = buildFactOpDraft(
    memberSubject(memberPubkey),
    [
      fact("type", type),
      fact("schema", "1"),
      fact("controls", memberPubkey),
      fact(active ? "member_of" : "not_member_of", group.id, group.creator),
    ],
    {},
    {externalIdentifiers: [group.id]}
  )
  draft.tags.push(...groupTags(group))
  return draft
}

/** Must be signed by memberPubkey. */
export function createMembershipDraft(
  group: GroupRef,
  memberPubkey: string,
  joined: boolean
): FactEventDraft {
  return memberDraft(group, memberPubkey, joined, "iris_group_membership")
}

/** Must be signed by the person giving or withdrawing this vouch. */
export function createVouchDraft(
  group: GroupRef,
  memberPubkey: string,
  active: boolean
): FactEventDraft {
  return memberDraft(group, memberPubkey, active, "iris_group_vouch")
}

function oneTag(event: NostrEvent, key: string): string[] | undefined {
  const tags = event.tags.filter((t) => t[0] === key)
  return tags.length === 1 ? tags[0].slice(1) : undefined
}

function exactTag(event: NostrEvent, key: string, value: string): boolean {
  const parts = oneTag(event, key)
  return parts?.length === 1 && parts[0] === value
}

function singleFact(facts: Fact[], key: string): string[] | undefined {
  const matches = facts.filter((f) => f.predicate === key)
  return matches.length === 1 ? matches[0].values : undefined
}

function value(facts: Fact[], key: string): string | undefined {
  const parts = singleFact(facts, key)
  return parts?.length === 1 ? parts[0] : undefined
}

/** Undefined is no expiry, null is malformed. Expiry is evaluated after LWW. */
function expiration(event: NostrEvent): number | undefined | null {
  const tags = event.tags.filter((t) => t[0] === "expiration")
  if (!tags.length) return undefined
  if (tags.length !== 1 || tags[0].length !== 2 || !/^\d+$/.test(tags[0][1])) return null
  const result = Number(tags[0][1])
  return Number.isSafeInteger(result) ? result : null
}

function validEvent(event: NostrEvent, now: number): boolean {
  // Validate bounds before parsing or verifying relay input. nostr-tools caches
  // signature verification on the immutable event object supplied by the store.
  if (
    !Number.isSafeInteger(event.created_at) ||
    event.created_at < 0 ||
    event.created_at > now ||
    event.content !== "" ||
    !Array.isArray(event.tags) ||
    event.tags.length > MAX_TAGS ||
    !event.tags.every(
      (t) =>
        Array.isArray(t) &&
        t.length > 0 &&
        t.length <= 8 &&
        t.every((p) => typeof p === "string" && p.length <= MAX_TAG_LENGTH)
    ) ||
    expiration(event) === null
  )
    return false
  try {
    return verifyEvent(event)
  } catch {
    return false
  }
}

function expired(event: NostrEvent, now: number): boolean {
  const expires = expiration(event)
  return typeof expires === "number" && expires <= now
}

/** NIP-01 replacement tie-break: lexically lowest id wins in the same second. */
function newer(candidate: NostrEvent, current?: NostrEvent): boolean {
  return (
    !current ||
    candidate.created_at > current.created_at ||
    (candidate.created_at === current.created_at && candidate.id < current.id)
  )
}

function parseGroupMetadata(event: NostrEvent, now: number): Group | null {
  if (event.kind !== GROUP_METADATA_KIND || !validEvent(event, now)) return null
  try {
    const parsed = parseFactSnapshotEvent(event)
    const facts = parsed.facts
    if (
      value(facts, "type") !== "iris_group" ||
      value(facts, "schema") !== "1" ||
      value(facts, "creator") !== event.pubkey
    )
      return null
    const ref = {id: parsed.subject, creator: event.pubkey}
    if (!exactTag(event, "a", groupAddress(ref)) || !exactTag(event, "h", ref.id))
      return null
    const name = value(facts, "name")
    const description = value(facts, "description")
    const policy = {
      direct: Number(value(facts, "direct_threshold")),
      secondDegree: Number(value(facts, "second_degree_threshold")),
    }
    if (
      !name?.trim() ||
      name.length > 80 ||
      description === undefined ||
      description.length > 2000 ||
      !validPolicy(policy)
    )
      return null
    return {
      ...ref,
      name,
      description,
      policy,
      eventId: event.id,
      createdAt: event.created_at,
    }
  } catch {
    return null
  }
}

export function parseGroup(
  event: NostrEvent,
  now = Math.floor(Date.now() / 1000)
): Group | null {
  const group = parseGroupMetadata(event, now)
  return group && !expired(event, now) ? group : null
}

export function listGroups(
  events: Iterable<NostrEvent>,
  now = Math.floor(Date.now() / 1000)
): Group[] {
  const latest = new Map<string, {group: Group; event: NostrEvent}>()
  for (const event of events) {
    const group = parseGroupMetadata(event, now)
    if (!group) continue
    const address = groupAddress(group)
    if (newer(event, latest.get(address)?.event)) latest.set(address, {group, event})
  }
  return Array.from(latest.values())
    .filter(({event}) => !expired(event, now))
    .map(({group}) => group)
    .sort(
      (a, b) =>
        b.createdAt - a.createdAt || groupAddress(a).localeCompare(groupAddress(b))
    )
}

type MemberClaim = {
  event: NostrEvent
  member: string
  active: boolean
  membership: boolean
}

function parseClaim(event: NostrEvent, group: GroupRef, now: number): MemberClaim | null {
  if (
    event.kind !== GROUP_FACT_KIND ||
    !validEvent(event, now) ||
    !exactTag(event, "h", group.id) ||
    !exactTag(event, "a", groupAddress(group))
  )
    return null
  try {
    const parsed = parseFactOpEvent(event)
    const facts = parsed.facts
    const type = value(facts, "type")
    if (
      (type !== "iris_group_membership" && type !== "iris_group_vouch") ||
      value(facts, "schema") !== "1"
    )
      return null
    const member = value(facts, "controls")
    if (!member || !PUBKEY.test(member) || parsed.subject !== memberSubject(member))
      return null
    const membership = type === "iris_group_membership"
    if (membership && event.pubkey !== member) return null
    const membershipFacts = facts.filter(
      (f) => f.predicate === "member_of" || f.predicate === "not_member_of"
    )
    if (membershipFacts.length !== 1) return null
    const state = membershipFacts[0]
    if (
      state.values.length !== 2 ||
      state.values[0] !== group.id ||
      state.values[1] !== group.creator
    )
      return null
    return {event, member, active: state.predicate === "member_of", membership}
  } catch {
    return null
  }
}

type Network = {direct: Set<string>; routes: Map<string, string[]>; truncated: boolean}

function trustNetwork(
  root: string,
  getFollows: (pubkey: string) => Iterable<string>
): Network {
  const network: Network = {direct: new Set([root]), routes: new Map(), truncated: false}
  let scanned = 0
  const read = (pubkey: string, limit: number): string[] => {
    const contacts = new Set<string>()
    let count = 0
    for (const contact of getFollows(pubkey)) {
      if (++count > MAX_FOLLOWS_SCANNED || ++scanned > MAX_GRAPH_EDGES) {
        network.truncated = true
        break
      }
      if (PUBKEY.test(contact) && contact !== pubkey) contacts.add(contact)
      if (contacts.size >= limit) {
        network.truncated = true
        break
      }
    }
    return [...contacts].sort()
  }
  const direct = read(root, MAX_DIRECT_CONTACTS)
  for (const contact of direct) network.direct.add(contact)
  for (const bridge of direct) {
    if (scanned >= MAX_GRAPH_EDGES) {
      network.truncated = true
      break
    }
    for (const voucher of read(bridge, MAX_FOLLOWS_SCANNED)) {
      if (network.direct.has(voucher)) continue
      const routes = network.routes.get(voucher) ?? []
      routes.push(bridge)
      network.routes.set(voucher, routes)
    }
  }
  return network
}

/** Maximum matching gives every counted voucher and direct trust bridge one seat. */
function independentVouchers(
  vouchers: string[],
  member: string,
  routes: Map<string, string[]>
): string[] {
  const matched = new Map<string, string>()
  const assign = (voucher: string, seen: Set<string>): boolean => {
    for (const bridge of routes.get(voucher) ?? []) {
      if (bridge === member || seen.has(bridge)) continue
      seen.add(bridge)
      const previous = matched.get(bridge)
      if (!previous || assign(previous, seen)) {
        matched.set(bridge, voucher)
        return true
      }
    }
    return false
  }
  for (const voucher of vouchers) assign(voucher, new Set())
  return [...matched.values()].sort()
}

export function deriveGroupMembers({
  group,
  events,
  viewer,
  view = "creator",
  policy = group.policy,
  getFollows,
  now = Math.floor(Date.now() / 1000),
}: {
  group: Group
  events: Iterable<NostrEvent>
  viewer?: string
  view?: GroupView
  policy?: GroupPolicy
  getFollows: (pubkey: string) => Iterable<string>
  now?: number
}): GroupMembers {
  assertRef(group)
  if (!validPolicy(policy)) throw new Error("Invalid group trust thresholds")
  const rootPubkey =
    view === "personal" && viewer && PUBKEY.test(viewer) ? viewer : group.creator
  const effectiveView = rootPubkey === group.creator ? "creator" : view
  const consent = new Map<string, MemberClaim>()
  const vouches = new Map<string, Map<string, MemberClaim>>()
  const candidates = new Set([group.creator])
  for (const event of events) {
    const claim = parseClaim(event, group, now)
    if (!claim) continue
    candidates.add(claim.member)
    if (claim.membership) {
      if (newer(event, consent.get(claim.member)?.event)) consent.set(claim.member, claim)
    } else {
      const byAuthor = vouches.get(claim.member) ?? new Map<string, MemberClaim>()
      if (newer(event, byAuthor.get(event.pubkey)?.event))
        byAuthor.set(event.pubkey, claim)
      vouches.set(claim.member, byAuthor)
    }
  }
  const joined = (pubkey: string): boolean => {
    const state = consent.get(pubkey)
    return state ? state.active && !expired(state.event, now) : pubkey === group.creator
  }
  const network = trustNetwork(rootPubkey, getFollows)
  const activeVouches = new Map<string, string[]>()
  const vouchedFor = new Map<string, string[]>()
  for (const pubkey of candidates) {
    const vouchers = [...(vouches.get(pubkey)?.entries() ?? [])]
      .filter(
        ([author, claim]) =>
          author !== pubkey && claim.active && !expired(claim.event, now)
      )
      .map(([author]) => author)
      .sort()
    activeVouches.set(pubkey, vouchers)
    for (const author of vouchers) {
      const targets = vouchedFor.get(author) ?? []
      targets.push(pubkey)
      vouchedFor.set(author, targets)
    }
  }
  const eligiblePubkeys = new Set<string>()
  const scores = (pubkey: string) => {
    const eligibleVouchers = (activeVouches.get(pubkey) ?? []).filter((author) =>
      eligiblePubkeys.has(author)
    )
    return {
      directVouchers: eligibleVouchers.filter((author) => network.direct.has(author)),
      secondDegreeVouchers: independentVouchers(
        eligibleVouchers.filter((author) => !network.direct.has(author)),
        pubkey,
        network.routes
      ),
    }
  }
  // Least fixed point: a mutually vouching pending cluster cannot bootstrap
  // membership. Only current eligible members can supply qualifying vouches.
  const queue = joined(group.creator) ? [group.creator] : []
  for (const seed of queue) eligiblePubkeys.add(seed)
  for (let index = 0; index < queue.length; index++) {
    for (const target of vouchedFor.get(queue[index]) ?? []) {
      if (!joined(target) || eligiblePubkeys.has(target)) continue
      const score = scores(target)
      if (
        score.directVouchers.length >= policy.direct ||
        score.secondDegreeVouchers.length >= policy.secondDegree
      ) {
        eligiblePubkeys.add(target)
        queue.push(target)
      }
    }
  }
  const members = [...candidates].sort().map((pubkey): GroupMember => {
    const vouchers = activeVouches.get(pubkey) ?? []
    const {directVouchers, secondDegreeVouchers} = scores(pubkey)
    const hasConsent = joined(pubkey)
    const eligible = eligiblePubkeys.has(pubkey)
    let reason = "Waiting for trusted vouches"
    if (!hasConsent) reason = "Not currently joined"
    else if (pubkey === group.creator) reason = "Group creator"
    else if (directVouchers.length >= policy.direct)
      reason = "Meets direct vouch threshold"
    else if (secondDegreeVouchers.length >= policy.secondDegree)
      reason = "Meets independent second-degree threshold"
    return {
      pubkey,
      joined: hasConsent,
      eligible,
      reason,
      vouchers,
      directVouchers,
      secondDegreeVouchers,
      directVouches: directVouchers.length,
      secondDegreeVouches: secondDegreeVouchers.length,
    }
  })
  const evidenceEventIds = new Set([group.eventId])
  for (const member of members) {
    if (!member.eligible) continue
    const joinedEvent = consent.get(member.pubkey)?.event.id
    if (joinedEvent) evidenceEventIds.add(joinedEvent)
    for (const author of [...member.directVouchers, ...member.secondDegreeVouchers]) {
      const vouchEvent = vouches.get(member.pubkey)?.get(author)?.event.id
      if (vouchEvent) evidenceEventIds.add(vouchEvent)
    }
  }
  return {
    members,
    byPubkey: new Map(members.map((member) => [member.pubkey, member])),
    eligiblePubkeys,
    authorityPubkeys: chooseTrustedAuthors({
      rootPubkey,
      eligibleAuthors: eligiblePubkeys,
      directFollows: network.direct,
    }),
    evidenceEventIds: [...evidenceEventIds].sort(),
    rootPubkey,
    view: effectiveView,
    policy: {...policy},
    truncated: network.truncated,
  }
}

/** A poll pins the creator's declared view; the store also gates relay readiness. */
export function deriveGroupElectorate(
  input: Parameters<typeof deriveGroupMembers>[0]
): GroupElectorate {
  const state = deriveGroupMembers({
    ...input,
    view: "creator",
    viewer: undefined,
    policy: input.group.policy,
  })
  if (state.truncated)
    throw new Error("Load the complete trust view before opening a poll")
  if (
    state.eligiblePubkeys.size > 512 ||
    state.authorityPubkeys.size > 257 ||
    state.evidenceEventIds.length > 2048
  ) {
    throw new Error("This group exceeds the supported poll snapshot size")
  }
  return {
    rootPubkey: state.rootPubkey,
    policyEventId: input.group.eventId,
    policy: {...state.policy},
    memberPubkeys: [...state.eligiblePubkeys].sort(),
    authorityPubkeys: [...state.authorityPubkeys].sort(),
    evidenceEventIds: state.evidenceEventIds,
  }
}
