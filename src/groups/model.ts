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
import {verifyEvent, type Filter} from "nostr-tools"

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
  /** Minimal acyclic admission proof, chosen when this member became eligible. */
  proofVouchers: string[]
  proofBridges: string[]
  evidenceEventIds: string[]
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
  memberSnapshotLimited: boolean
  rootFollowEventId?: string
  /** Local authoring hint; the signed contact events remain the proof. */
  followProofPubkeys?: string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PUBKEY = /^[0-9a-f]{64}$/
const MAX_TAGS = 128
const MAX_TAG_LENGTH = 4096
const MAX_DIRECT_CONTACTS = 256
const MAX_FOLLOWS_SCANNED = 2048
const MAX_GRAPH_EDGES = 32768
const encoder = new TextEncoder()
const signatureCache = new WeakMap<NostrEvent, {fingerprint: string; valid: boolean}>()

function signedEventIsValid(event: NostrEvent): boolean {
  try {
    // Do not inherit nostr-tools' verified symbol from a copied or mutated event.
    const plain = {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags,
      content: event.content,
      sig: event.sig,
    }
    const fingerprint = JSON.stringify(plain)
    const cached = signatureCache.get(event)
    if (cached?.fingerprint === fingerprint) return cached.valid
    const valid = verifyEvent(plain)
    signatureCache.set(event, {fingerprint, valid})
    return valid
  } catch {
    return false
  }
}

/** Latest signed contact lists for this view, independent of a personal graph cache. */
export function deriveGroupFollowLists(
  events: Iterable<NostrEvent>,
  now = Math.floor(Date.now() / 1000)
): Map<string, Set<string>> {
  const latest = new Map<string, NostrEvent>()
  for (const event of events) {
    if (
      event.kind !== 3 ||
      !Number.isSafeInteger(event.created_at) ||
      event.created_at < 0 ||
      event.created_at > now ||
      !signedEventIsValid(event)
    )
      continue
    if (newer(event, latest.get(event.pubkey))) latest.set(event.pubkey, event)
  }
  return new Map(
    [...latest].map(([author, event]) => [
      author,
      new Set(
        expired(event, now)
          ? []
          : event.tags
              .filter((tag) => tag[0] === "p" && PUBKEY.test(tag[1] ?? ""))
              .map((tag) => tag[1])
      ),
    ])
  )
}

function validPolicy(policy: GroupPolicy): boolean {
  if (!policy) return false
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
  type: "iris_group_membership" | "iris_group_attestation"
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

/** Must be signed by the person giving or withdrawing this attestation. */
export function createMembershipAttestationDraft(
  group: GroupRef,
  memberPubkey: string,
  active: boolean
): FactEventDraft {
  return memberDraft(group, memberPubkey, active, "iris_group_attestation")
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
  // Validate bounds before parsing or verifying relay input. Cached verification
  // is invalidated whenever a protocol field changes.
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
    return signedEventIsValid(event)
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
      (type !== "iris_group_membership" && type !== "iris_group_attestation") ||
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

/** Validate before retaining relay data; distinct event IDs may update one state. */
export function parseGroupEventState(
  event: NostrEvent,
  now = Math.floor(Date.now() / 1000)
): {
  key: string
  category: "membership" | "vouch" | "metadata"
  memberPubkey?: string
} | null {
  if (event.kind === GROUP_METADATA_KIND) {
    const group = parseGroupMetadata(event, now)
    return group ? {key: groupAddress(group), category: "metadata"} : null
  }
  if (event.kind !== GROUP_FACT_KIND || !validEvent(event, now)) return null
  const address = oneTag(event, "a")
  if (address?.length !== 1) return null
  const [kind, creator, id, extra] = address[0].split(":")
  if (
    kind !== String(GROUP_METADATA_KIND) ||
    extra !== undefined ||
    !PUBKEY.test(creator ?? "") ||
    !UUID.test(id ?? "")
  )
    return null
  const claim = parseClaim(event, {id, creator}, now)
  if (!claim) return null
  const category = claim.membership ? "membership" : "vouch"
  return {
    key: JSON.stringify([address[0], event.pubkey, category, claim.member]),
    category,
    memberPubkey: claim.member,
  }
}

/** Each known author gets its own relay limit, separate from the open join inbox. */
export function protectedGroupFactFilters(
  group: GroupRef,
  memberKeys: Iterable<string>,
  voucherKeys?: Iterable<string>
): Filter[] {
  const members = [...new Set(memberKeys)].filter((key) => PUBKEY.test(key)).sort()
  const authors = [...new Set(voucherKeys ?? members)]
    .filter((key) => PUBKEY.test(key))
    .sort()
  const address = groupAddress(group)
  const filters: Filter[] = members.map((author) => ({
    kinds: [GROUP_FACT_KIND],
    authors: [author],
    "#a": [address],
    "#i": [memberSubject(author)],
    limit: 16,
  }))
  // The creator is already the seed and occurs in every group's p indexes.
  const targets = members.filter((key) => key !== group.creator)
  if (targets.length) {
    for (const author of authors) {
      filters.push({
        kinds: [GROUP_FACT_KIND],
        authors: [author],
        "#a": [address],
        "#p": targets,
        limit: 128,
      })
    }
  }
  return filters
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
      if (contacts.size > limit) {
        contacts.delete(contact)
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
): Array<{voucher: string; bridge: string}> {
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
  return [...matched.entries()]
    .map(([bridge, voucher]) => ({bridge, voucher}))
    .sort((a, b) => a.voucher.localeCompare(b.voucher))
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
  const admissionProof = new Map<string, {vouchers: string[]; bridges: string[]}>()
  const scores = (pubkey: string) => {
    const eligibleVouchers = (activeVouches.get(pubkey) ?? []).filter((author) =>
      eligiblePubkeys.has(author)
    )
    const routes = independentVouchers(
      eligibleVouchers.filter((author) => !network.direct.has(author)),
      pubkey,
      network.routes
    )
    return {
      directVouchers: eligibleVouchers.filter((author) => network.direct.has(author)),
      secondDegreeVouchers: routes.map((route) => route.voucher),
      secondDegreeBridges: routes.map((route) => route.bridge),
    }
  }
  // Least fixed point: a mutually vouching pending cluster cannot bootstrap
  // membership. Only current eligible members can supply qualifying vouches.
  const queue = joined(group.creator) ? [group.creator] : []
  for (const seed of queue) eligiblePubkeys.add(seed)
  for (let index = 0; index < queue.length; index++) {
    for (const target of (vouchedFor.get(queue[index]) ?? []).sort()) {
      if (!joined(target) || eligiblePubkeys.has(target)) continue
      const score = scores(target)
      if (
        score.directVouchers.length >= policy.direct ||
        score.secondDegreeVouchers.length >= policy.secondDegree
      ) {
        const directEnough = score.directVouchers.length >= policy.direct
        admissionProof.set(target, {
          vouchers: directEnough
            ? score.directVouchers.slice(0, policy.direct)
            : score.secondDegreeVouchers.slice(0, policy.secondDegree),
          bridges: directEnough
            ? []
            : score.secondDegreeBridges.slice(0, policy.secondDegree),
        })
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
    let reason = "Waiting for trusted confirmations"
    if (!hasConsent) reason = "Not currently joined"
    else if (pubkey === group.creator) reason = "Group creator"
    else if (directVouchers.length >= policy.direct)
      reason = "Meets direct confirmation threshold"
    else if (secondDegreeVouchers.length >= policy.secondDegree)
      reason = "Meets independent second-degree threshold"
    const evidenceEventIds: string[] = []
    const proof = admissionProof.get(pubkey) ?? {vouchers: [], bridges: []}
    const joinedEvent = consent.get(pubkey)?.event.id
    if (joinedEvent) evidenceEventIds.push(joinedEvent)
    for (const author of proof.vouchers) {
      const vouchEvent = vouches.get(pubkey)?.get(author)?.event.id
      if (vouchEvent) evidenceEventIds.push(vouchEvent)
    }
    return {
      pubkey,
      joined: hasConsent,
      eligible,
      reason,
      vouchers,
      directVouchers,
      secondDegreeVouchers,
      proofVouchers: proof.vouchers,
      proofBridges: proof.bridges,
      evidenceEventIds,
      directVouches: directVouchers.length,
      secondDegreeVouches: secondDegreeVouchers.length,
    }
  })
  const evidenceEventIds = new Set([group.eventId])
  for (const member of members) {
    if (!member.eligible) continue
    member.evidenceEventIds.forEach((id) => evidenceEventIds.add(id))
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
  const selected = new Set(state.authorityPubkeys)
  if (state.eligiblePubkeys.has(input.group.creator)) selected.add(input.group.creator)
  if (input.viewer && state.eligiblePubkeys.has(input.viewer)) selected.add(input.viewer)
  for (const member of [...state.eligiblePubkeys].sort()) {
    if (selected.size >= 512) break
    selected.add(member)
  }
  const evidence = new Set([input.group.eventId])
  const followProofPubkeys = new Set([input.group.creator])
  const seen = new Set<string>()
  const queue = [...selected]
  for (let index = 0; index < queue.length; index++) {
    const pubkey = queue[index]
    if (seen.has(pubkey)) continue
    seen.add(pubkey)
    const member = state.byPubkey.get(pubkey)
    if (!member?.eligible) continue
    member.evidenceEventIds.forEach((id) => evidence.add(id))
    queue.push(...member.proofVouchers)
    member.proofBridges.forEach((key) => followProofPubkeys.add(key))
  }
  if (state.authorityPubkeys.size > 257 || evidence.size > 2048) {
    throw new Error("This group exceeds the supported poll snapshot size")
  }
  return {
    rootPubkey: state.rootPubkey,
    policyEventId: input.group.eventId,
    policy: {...state.policy},
    memberPubkeys: [...selected].sort(),
    authorityPubkeys: [...state.authorityPubkeys].sort(),
    evidenceEventIds: [...evidence].sort(),
    memberSnapshotLimited: selected.size < state.eligiblePubkeys.size,
    followProofPubkeys: [...followProofPubkeys].sort(),
  }
}

/** Replay a signed poll author's evidence. This proves support, not completeness. */
export function verifyGroupElectorateEvidence(
  groupRef: GroupRef,
  snapshot: GroupElectorate,
  events: Iterable<NostrEvent>,
  pollCreatedAt: number
): {valid: boolean; reason?: string} {
  const invalid = (reason: string) => ({valid: false, reason})
  if (
    !snapshot ||
    !Array.isArray(snapshot.memberPubkeys) ||
    !Array.isArray(snapshot.authorityPubkeys) ||
    !Array.isArray(snapshot.evidenceEventIds) ||
    typeof snapshot.memberSnapshotLimited !== "boolean" ||
    !Number.isSafeInteger(pollCreatedAt) ||
    pollCreatedAt < 0 ||
    snapshot.rootPubkey !== groupRef.creator ||
    !validPolicy(snapshot.policy)
  ) {
    return invalid("The poll's group policy is invalid")
  }
  const members = new Set(snapshot.memberPubkeys)
  const authority = new Set(snapshot.authorityPubkeys)
  const evidenceIds = new Set(snapshot.evidenceEventIds)
  if (
    !members.size ||
    members.size > 512 ||
    authority.size > 257 ||
    evidenceIds.size > 2048 ||
    members.size !== snapshot.memberPubkeys.length ||
    authority.size !== snapshot.authorityPubkeys.length ||
    evidenceIds.size !== snapshot.evidenceEventIds.length ||
    [...members].some((key) => !PUBKEY.test(key)) ||
    [...authority].some((key) => !members.has(key)) ||
    !evidenceIds.has(snapshot.policyEventId)
  ) {
    return invalid("The poll's electorate is malformed")
  }
  const received = new Map<string, NostrEvent>()
  for (const event of events) received.set(event.id, event)
  const committed: NostrEvent[] = []
  for (const id of evidenceIds) {
    const event = received.get(id)
    if (!event) return invalid("Some signed membership evidence is missing")
    if (
      !Number.isSafeInteger(event.created_at) ||
      event.created_at > pollCreatedAt ||
      event.created_at < 0
    ) {
      return invalid("Membership evidence was created after this poll")
    }
    try {
      if (!signedEventIsValid(event))
        return invalid("Membership evidence has an invalid signature")
    } catch {
      return invalid("Membership evidence has an invalid signature")
    }
    committed.push(event)
  }
  const policyEvent = received.get(snapshot.policyEventId)
  const group = policyEvent && parseGroup(policyEvent, pollCreatedAt)
  if (
    !group ||
    group.id !== groupRef.id ||
    group.creator !== groupRef.creator ||
    group.policy.direct !== snapshot.policy.direct ||
    group.policy.secondDegree !== snapshot.policy.secondDegree
  ) {
    return invalid("The signed group policy does not match this poll")
  }
  const follows = new Map<string, NostrEvent>()
  const factStates = new Map<string, NostrEvent>()
  for (const event of committed) {
    if (event.kind === 3) {
      if (newer(event, follows.get(event.pubkey))) follows.set(event.pubkey, event)
    } else if (event.kind === GROUP_FACT_KIND || event.kind === GROUP_METADATA_KIND) {
      const state = parseGroupEventState(event, pollCreatedAt)
      if (!state || !exactTag(event, "a", groupAddress(groupRef))) {
        return invalid("The poll includes unrelated or invalid membership evidence")
      }
      if (event.kind === GROUP_FACT_KIND && newer(event, factStates.get(state.key))) {
        factStates.set(state.key, event)
      }
    } else return invalid("The poll includes unsupported membership evidence")
  }
  const needsRootFollows = [...authority].some((key) => key !== groupRef.creator)
  const rootFollowEvent =
    snapshot.rootFollowEventId && received.get(snapshot.rootFollowEventId)
  if (
    (needsRootFollows && !rootFollowEvent) ||
    (snapshot.rootFollowEventId &&
      (!evidenceIds.has(snapshot.rootFollowEventId) ||
        !rootFollowEvent ||
        rootFollowEvent.kind !== 3 ||
        rootFollowEvent.pubkey !== groupRef.creator ||
        follows.get(groupRef.creator)?.id !== rootFollowEvent.id))
  ) {
    return invalid("The creator's signed trust list is missing or does not match")
  }
  // Reject a known rollback. Absence of a newer relay event is never proof that
  // none exists, which is why this remains an observed advisory snapshot.
  if (rootFollowEvent) {
    for (const event of received.values()) {
      if (
        event.kind !== 3 ||
        event.pubkey !== groupRef.creator ||
        event.created_at > pollCreatedAt ||
        !newer(event, rootFollowEvent)
      )
        continue
      try {
        if (signedEventIsValid(event))
          return invalid("A newer creator trust list predates this poll")
      } catch {
        /* Malformed uncommitted input cannot change the proof. */
      }
    }
  }
  // A positive proof cannot hide a newer withdrawal already known to the
  // receiver. Later-than-opening changes still leave a frozen poll unchanged.
  for (const event of received.values()) {
    if (
      !Number.isSafeInteger(event.created_at) ||
      event.created_at < 0 ||
      event.created_at > pollCreatedAt
    )
      continue
    if (event.kind === GROUP_FACT_KIND) {
      const state = parseGroupEventState(event, pollCreatedAt)
      const previous = state && factStates.get(state.key)
      if (state && previous && newer(event, previous)) factStates.set(state.key, event)
    } else if (
      event.kind === 3 &&
      follows.has(event.pubkey) &&
      newer(event, follows.get(event.pubkey)) &&
      signedEventIsValid(event)
    ) {
      follows.set(event.pubkey, event)
    }
  }
  const getFollows = (pubkey: string): string[] => {
    const event = follows.get(pubkey)
    if (!event || expired(event, pollCreatedAt)) return []
    return event.tags
      .filter((tag) => tag[0] === "p" && PUBKEY.test(tag[1] ?? ""))
      .map((tag) => tag[1])
  }
  const projected = deriveGroupMembers({
    group,
    events: [...factStates.values()],
    getFollows,
    now: pollCreatedAt,
  })
  if (projected.truncated)
    return invalid("The signed trust graph exceeds the supported snapshot size")
  if ([...members].some((key) => !projected.eligiblePubkeys.has(key))) {
    return invalid(
      "A declared member is not supported by signed consent and attestations"
    )
  }
  if ([...authority].some((key) => !projected.authorityPubkeys.has(key))) {
    return invalid("A declared trusted voter is not an eligible direct contact")
  }
  return {valid: true}
}
