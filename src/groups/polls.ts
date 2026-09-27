import {verifyEvent, type Event as SignedEvent} from "nostr-tools"

/** NIP-88 poll semantics. Callers supply signature-verified events. */
export const KIND_POLL = 1068
export const KIND_POLL_RESPONSE = 1018

export interface PollEvent {
  id: string
  pubkey: string
  kind?: number
  created_at?: number
  content: string
  tags: string[][]
}

export type PollType = "singlechoice" | "multiplechoice"
export interface Poll {
  id: string
  question: string
  createdAt: number
  options: {id: string; label: string}[]
  type: PollType
  endsAt?: number
  relays: string[]
  electorate?: PollElectorate
  groupId?: string
  evidenceEvents?: SignedEvent[]
}

const isHex = (value: string) => /^[0-9a-f]{64}$/.test(value)
const isTimestamp = (value: number | undefined): value is number =>
  value !== undefined && Number.isSafeInteger(value) && value >= 0

export interface PollElectorate {
  rootPubkey: string
  policyEventId: string
  policy: {direct: number; secondDegree: number}
  memberPubkeys: string[]
  authorityPubkeys: string[]
  evidenceEventIds: string[]
  rootFollowEventId?: string
  memberSnapshotLimited: boolean
}

export const MAX_POLL_MEMBERS = 512
export const MAX_POLL_AUTHORITIES = 257
export const MAX_POLL_EVIDENCE = 2048
const MAX_POLL_BYTES = 64 * 1024

function canonicalElectorate(snapshot: PollElectorate): PollElectorate {
  const validList = (values: string[], max: number) =>
    values.length > 0 &&
    values.length <= max &&
    values.every(isHex) &&
    new Set(values).size === values.length
  if (
    typeof snapshot.memberSnapshotLimited !== "boolean" ||
    !isHex(snapshot.rootPubkey) ||
    !isHex(snapshot.policyEventId) ||
    ![snapshot.policy.direct, snapshot.policy.secondDegree].every(
      (n) => Number.isInteger(n) && n >= 1 && n <= 20
    ) ||
    !validList(snapshot.memberPubkeys, MAX_POLL_MEMBERS) ||
    !validList(snapshot.authorityPubkeys, MAX_POLL_AUTHORITIES) ||
    !validList(snapshot.evidenceEventIds, MAX_POLL_EVIDENCE) ||
    !snapshot.evidenceEventIds.includes(snapshot.policyEventId) ||
    (snapshot.rootFollowEventId !== undefined &&
      (!isHex(snapshot.rootFollowEventId) ||
        !snapshot.evidenceEventIds.includes(snapshot.rootFollowEventId))) ||
    (snapshot.authorityPubkeys.some((key) => key !== snapshot.rootPubkey) &&
      !snapshot.rootFollowEventId) ||
    !snapshot.authorityPubkeys.includes(snapshot.rootPubkey) ||
    snapshot.authorityPubkeys.some((key) => !snapshot.memberPubkeys.includes(key))
  ) {
    throw new Error(
      "The voter snapshot is invalid or too large. Refresh the group before creating a poll."
    )
  }
  return {
    ...snapshot,
    policy: {...snapshot.policy},
    memberPubkeys: [...snapshot.memberPubkeys].sort(),
    authorityPubkeys: [...snapshot.authorityPubkeys].sort(),
    evidenceEventIds: [...snapshot.evidenceEventIds].sort(),
  }
}

/** The ordinary signed poll event commits these author-observed sets and evidence IDs. */
export function buildPollElectorateTags(input: PollElectorate): string[][] {
  const snapshot = canonicalElectorate(input)
  const trusted = new Set(snapshot.authorityPubkeys)
  return [
    [
      "iris-electorate",
      "1",
      snapshot.rootPubkey,
      snapshot.policyEventId,
      String(snapshot.policy.direct),
      String(snapshot.policy.secondDegree),
      snapshot.rootFollowEventId ?? "",
      snapshot.memberSnapshotLimited ? "partial" : "observed",
    ],
    ...snapshot.memberPubkeys.map((key) => [
      "iris-voter",
      key,
      trusted.has(key) ? "trusted" : "member",
    ]),
    ...snapshot.evidenceEventIds.map((id) => ["iris-evidence", id]),
  ]
}

function verifiedEvidence(event: PollEvent & {sig?: string}): SignedEvent {
  if (
    !event ||
    !isTimestamp(event.created_at) ||
    event.kind === undefined ||
    !event.sig
  ) {
    throw new Error("A signed voter proof is missing or malformed.")
  }
  const raw: SignedEvent = {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    created_at: event.created_at,
    content: event.content,
    tags: event.tags,
    sig: event.sig,
  }
  if (!verifyEvent(raw)) throw new Error("A voter proof has an invalid signature.")
  // Strip verifyEvent's cached marker and any transport metadata from the bundle.
  return {
    id: raw.id,
    pubkey: raw.pubkey,
    kind: raw.kind,
    created_at: raw.created_at,
    content: raw.content,
    tags: raw.tags,
    sig: raw.sig,
  }
}

/** Carry every committed original signature so replaceable history cannot disappear. */
export function buildPollEvidenceTags(
  snapshot: PollElectorate,
  events: Iterable<PollEvent & {sig?: string}>
): string[][] {
  canonicalElectorate(snapshot)
  const byId = new Map([...events].map((event) => [event.id, event]))
  const bundle = snapshot.evidenceEventIds
    .map((id) => {
      const event = byId.get(id)
      if (!event)
        throw new Error("Wait for all signed voter proofs before posting the poll.")
      return verifiedEvidence(event)
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  const tags = [["iris-evidence-bundle", "1", JSON.stringify(bundle)]]
  assertPollSize({content: "", tags})
  return tags
}

function parsePollEvidence(
  event: PollEvent,
  snapshot: PollElectorate | undefined
): SignedEvent[] | undefined {
  const bundles = event.tags.filter((tag) => tag[0] === "iris-evidence-bundle")
  if (!bundles.length) return undefined
  if (
    !snapshot ||
    bundles.length !== 1 ||
    bundles[0].length !== 3 ||
    bundles[0][1] !== "1"
  )
    throw new Error("Invalid voter evidence bundle")
  const decoded = JSON.parse(bundles[0][2])
  if (
    !Array.isArray(decoded) ||
    decoded.length !== snapshot.evidenceEventIds.length ||
    decoded.length > MAX_POLL_EVIDENCE
  )
    throw new Error("Incomplete voter evidence bundle")
  const ids = new Set<string>()
  const expected = new Set(snapshot.evidenceEventIds)
  return decoded.map((value) => {
    const proof = verifiedEvidence(value)
    if (
      !expected.has(proof.id) ||
      ids.has(proof.id) ||
      proof.created_at > event.created_at!
    )
      throw new Error("Voter evidence does not match the poll commitment")
    ids.add(proof.id)
    return proof
  })
}

function parsePollElectorate(event: PollEvent): PollElectorate | undefined {
  const header = event.tags.filter((tag) => tag[0] === "iris-electorate")
  const voters = event.tags.filter((tag) => tag[0] === "iris-voter")
  const evidence = event.tags.filter((tag) => tag[0] === "iris-evidence")
  if (!header.length && !voters.length && !evidence.length) return undefined
  if (
    header.length !== 1 ||
    header[0].length !== 8 ||
    header[0][1] !== "1" ||
    (header[0][7] !== "partial" && header[0][7] !== "observed") ||
    !/^\d+$/.test(header[0][4]) ||
    !/^\d+$/.test(header[0][5]) ||
    voters.some(
      (tag) => tag.length !== 3 || (tag[2] !== "trusted" && tag[2] !== "member")
    ) ||
    evidence.some((tag) => tag.length !== 2)
  )
    throw new Error("Invalid voter snapshot")
  const snapshot = canonicalElectorate({
    rootPubkey: header[0][2],
    policyEventId: header[0][3],
    policy: {direct: Number(header[0][4]), secondDegree: Number(header[0][5])},
    memberPubkeys: voters.map((tag) => tag[1]),
    authorityPubkeys: voters.filter((tag) => tag[2] === "trusted").map((tag) => tag[1]),
    evidenceEventIds: evidence.map((tag) => tag[1]),
    ...(header[0][6] ? {rootFollowEventId: header[0][6]} : {}),
    memberSnapshotLimited: header[0][7] === "partial",
  })
  const groups = event.tags.filter((tag) => tag[0] === "h")
  const addresses = event.tags.filter(
    (tag) => tag[0] === "a" && tag[1]?.startsWith("37368:")
  )
  if (
    groups.length !== 1 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      groups[0][1] ?? ""
    ) ||
    addresses.length !== 1 ||
    addresses[0][1] !== `37368:${snapshot.rootPubkey}:${groups[0][1]}` ||
    !snapshot.memberPubkeys.includes(event.pubkey)
  )
    throw new Error("Voter snapshot does not match this group or author")
  assertPollSize(event)
  return snapshot
}

export function assertPollSize(draft: {content: string; tags: string[][]}): void {
  // Reserve space for the event envelope and signature; never silently clip a roster.
  if (
    new TextEncoder().encode(JSON.stringify({content: draft.content, tags: draft.tags}))
      .byteLength +
      1024 >
    MAX_POLL_BYTES
  ) {
    throw new Error(
      "The signed voter proofs exceed the poll size limit. No voters or proofs were dropped."
    )
  }
}

export function pollRelayUrls(values: readonly string[]): string[] {
  const urls = new Set<string>()
  for (const value of values) {
    try {
      const url = new URL(value)
      if (
        (url.protocol === "ws:" || url.protocol === "wss:") &&
        !url.username &&
        !url.password
      ) {
        urls.add(url.href)
      }
    } catch {
      // Invalid relay hints do not change the meaning of a poll.
    }
  }
  return [...urls]
}

export function parsePoll(event: PollEvent): Poll | null {
  if (
    event.kind !== KIND_POLL ||
    !isHex(event.id) ||
    !isHex(event.pubkey) ||
    !isTimestamp(event.created_at) ||
    !event.content.trim()
  )
    return null
  const options = event.tags
    .filter((tag) => tag[0] === "option")
    .map((tag) => ({id: tag[1], label: tag[2]}))
  if (
    options.length < 2 ||
    options.some(({id, label}) => !id || !/^[a-zA-Z0-9]+$/.test(id) || !label?.trim()) ||
    new Set(options.map(({id}) => id)).size !== options.length
  )
    return null
  const typeTags = event.tags.filter((tag) => tag[0] === "polltype")
  const type = typeTags.length ? typeTags[0][1] : "singlechoice"
  if (typeTags.length > 1 || (type !== "singlechoice" && type !== "multiplechoice"))
    return null
  const endTags = event.tags.filter((tag) => tag[0] === "endsAt")
  const endsAt = endTags.length ? Number(endTags[0][1]) : undefined
  if (
    endTags.length > 1 ||
    (endTags.length &&
      (!/^\d+$/.test(endTags[0][1] ?? "") ||
        !isTimestamp(endsAt) ||
        endsAt < event.created_at))
  )
    return null
  let electorate: PollElectorate | undefined
  let evidenceEvents: SignedEvent[] | undefined
  try {
    electorate = parsePollElectorate(event)
    evidenceEvents = parsePollEvidence(event, electorate)
  } catch {
    return null
  }
  return {
    id: event.id,
    question: event.content,
    electorate,
    evidenceEvents,
    groupId: electorate ? event.tags.find((tag) => tag[0] === "h")?.[1] : undefined,
    createdAt: event.created_at,
    options,
    type,
    endsAt,
    relays: pollRelayUrls(
      event.tags.filter((tag) => tag[0] === "relay").map((tag) => tag[1])
    ),
  }
}

export interface PollResponse {
  event: PollEvent
  selections: string[]
}

export function parsePollResponse(
  poll: Poll,
  event: PollEvent,
  now = Math.floor(Date.now() / 1000)
): PollResponse | null {
  if (
    event.kind !== KIND_POLL_RESPONSE ||
    !isHex(event.id) ||
    !isHex(event.pubkey) ||
    !isTimestamp(event.created_at) ||
    event.created_at < poll.createdAt ||
    event.created_at > now ||
    (poll.endsAt !== undefined && event.created_at > poll.endsAt)
  )
    return null
  const references = event.tags.filter((tag) => tag[0] === "e")
  if (references.length !== 1 || references[0][1] !== poll.id) return null
  const responseTags = event.tags.filter((tag) => tag[0] === "response")
  // NIP-88 expressly uses the first response for single-choice polls.
  const selections = [
    ...new Set(
      (poll.type === "singlechoice" ? responseTags.slice(0, 1) : responseTags).map(
        (tag) => tag[1]
      )
    ),
  ]
  if (
    !selections.length ||
    selections.some((id) => !poll.options.some((option) => option.id === id))
  )
    return null
  return {event, selections}
}

export function tallyPollResponses(
  poll: Poll,
  events: Iterable<PollEvent>,
  {
    now = Math.floor(Date.now() / 1000),
    isEligible = () => true,
  }: {
    now?: number
    isEligible?: (pubkey: string) => boolean
  } = {}
) {
  const responsesByPubkey = new Map<string, PollResponse>()
  for (const event of events) {
    const response = parsePollResponse(poll, event, now)
    if (!response || !isEligible(event.pubkey)) continue
    const previous = responsesByPubkey.get(event.pubkey)?.event
    // NIP-88 leaves timestamp ties undefined; lower event ID is our stable tie-break.
    if (
      !previous ||
      event.created_at! > previous.created_at! ||
      (event.created_at === previous.created_at && event.id < previous.id)
    ) {
      responsesByPubkey.set(event.pubkey, response)
    }
  }
  const counts: Record<string, number> = Object.fromEntries(
    poll.options.map(({id}) => [id, 0])
  )
  for (const response of responsesByPubkey.values()) {
    for (const id of response.selections) counts[id]++
  }
  return {counts, total: responsesByPubkey.size, responsesByPubkey}
}

export function buildPollTags({
  options,
  type = "singlechoice",
  endsAt,
  relays = [],
}: {
  options: readonly string[]
  type?: PollType
  endsAt?: number
  relays?: readonly string[]
}): string[][] {
  if (options.length < 2 || options.some((option) => !option.trim()))
    throw new Error("Add at least two choices.")
  if (type !== "singlechoice" && type !== "multiplechoice")
    throw new Error("Unsupported poll type.")
  if (endsAt !== undefined && !isTimestamp(endsAt))
    throw new Error("Choose a valid poll duration.")
  return [
    ...options.map((label, index) => ["option", String(index + 1), label.trim()]),
    ["polltype", type],
    ...(endsAt !== undefined ? [["endsAt", String(endsAt)]] : []),
    ...pollRelayUrls(relays).map((url) => ["relay", url]),
  ]
}

export function buildPollResponseTags(
  poll: Poll,
  optionIds: readonly string[]
): string[][] {
  const ids = [...new Set(optionIds)]
  if (
    !ids.length ||
    (poll.type === "singlechoice" && ids.length !== 1) ||
    ids.some((id) => !poll.options.some((option) => option.id === id))
  )
    throw new Error("Choose a valid poll option.")
  return [["e", poll.id], ...ids.map((id) => ["response", id])]
}

/** Both advisory totals use the immutable author-signed snapshot, never today's graph. */
export function tallyPollElectorate(
  poll: Poll,
  events: Iterable<PollEvent>,
  now = Math.floor(Date.now() / 1000)
) {
  if (!poll.electorate) throw new Error("This poll has no frozen voter snapshot")
  const all = [...events]
  const members = new Set(poll.electorate.memberPubkeys)
  const trusted = new Set(poll.electorate.authorityPubkeys)
  return {
    members: tallyPollResponses(poll, all, {now, isEligible: (key) => members.has(key)}),
    trusted: tallyPollResponses(poll, all, {now, isEligible: (key) => trusted.has(key)}),
  }
}

export interface PollResponseFilter {
  [tag: `#${string}`]: string[]
  kinds: number[]
  "#e": string[]
  authors?: string[]
  since: number
  until?: number
  limit: number
}
export const POLL_RESPONSES_PER_KEY = 32

/** Per-key historical filters stop one prolific voter from hiding everyone else's votes. */
export function pollResponseQueries(poll: Poll) {
  const base = {
    kinds: [KIND_POLL_RESPONSE],
    "#e": [poll.id],
    since: poll.createdAt,
    ...(poll.endsAt !== undefined ? {until: poll.endsAt} : {}),
  }
  const keys = poll.electorate ? [...poll.electorate.memberPubkeys] : undefined
  const history: PollResponseFilter[][] = []
  if (keys) {
    for (let i = 0; i < keys.length; i += 16) {
      history.push(
        keys
          .slice(i, i + 16)
          .map((key) => ({...base, authors: [key], limit: POLL_RESPONSES_PER_KEY}))
      )
    }
  } else history.push([{...base, limit: 5000}])
  return {history, live: {...base, ...(keys ? {authors: keys} : {}), limit: 0}}
}

export interface PollAuthorityVerification {
  valid: boolean
  reason?: string
}

/** Require the root's own signature for any delegated authority, not the poll author's claim. */
export function verifyPollAuthority(
  poll: Poll,
  events: Iterable<PollEvent & {sig?: string}>
): PollAuthorityVerification {
  const snapshot = poll.electorate
  if (!snapshot) return {valid: false, reason: "This poll has no fixed voter snapshot."}
  if (!snapshot.rootFollowEventId) {
    return snapshot.authorityPubkeys.every((key) => key === snapshot.rootPubkey)
      ? {valid: true}
      : {valid: false, reason: "The creator's signed contact list is missing."}
  }
  const signedLists: SignedEvent[] = []
  for (const event of events) {
    if (
      event.kind !== 3 ||
      event.pubkey !== snapshot.rootPubkey ||
      !isTimestamp(event.created_at) ||
      event.created_at > poll.createdAt ||
      !event.sig
    )
      continue
    // Copy protocol fields so a cached verification symbol cannot authenticate mutated data.
    const raw: SignedEvent = {
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      created_at: event.created_at,
      content: event.content,
      tags: event.tags,
      sig: event.sig,
    }
    try {
      if (verifyEvent(raw)) signedLists.push(raw)
    } catch {
      /* malformed proof */
    }
  }
  const proof = signedLists.find((event) => event.id === snapshot.rootFollowEventId)
  if (!proof)
    return {
      valid: false,
      reason: "The creator's signed contact-list proof is unavailable.",
    }
  const latest = signedLists.sort(
    (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)
  )[0]
  if (latest.id !== proof.id)
    return {
      valid: false,
      reason:
        "A newer creator contact list predates this poll; its trust snapshot is outdated.",
    }
  const direct = new Set(proof.tags.filter((tag) => tag[0] === "p").map((tag) => tag[1]))
  if (
    snapshot.authorityPubkeys.some(
      (key) => key !== snapshot.rootPubkey && !direct.has(key)
    )
  ) {
    return {
      valid: false,
      reason: "The trusted voter list does not match the creator's signed contacts.",
    }
  }
  return {valid: true}
}

/** Frozen membership prevents later graph edits from removing an admitted voter's control. */
export function isPollVoter(
  poll: Poll,
  pubkey: string | undefined,
  snapshotVerified: boolean,
  liveEligible: boolean
): boolean {
  if (!pubkey) return false
  return poll.electorate
    ? snapshotVerified && poll.electorate.memberPubkeys.includes(pubkey)
    : liveEligible
}

/** Keep a discovered rollback conflict across failed refreshes of the same poll. */
export function rememberPollRootEvidence(
  poll: Poll,
  previous: SignedEvent | undefined,
  incoming: Iterable<PollEvent & {sig?: string}>
): SignedEvent | undefined {
  let latest = previous
  for (const event of incoming) {
    if (
      event.kind !== 3 ||
      event.pubkey !== poll.electorate?.rootPubkey ||
      !isTimestamp(event.created_at) ||
      event.created_at > poll.createdAt
    )
      continue
    try {
      const candidate = verifiedEvidence(event)
      if (
        !latest ||
        candidate.created_at > latest.created_at ||
        (candidate.created_at === latest.created_at && candidate.id < latest.id)
      )
        latest = candidate
    } catch {
      /* An invalid event cannot establish or clear a conflict. */
    }
  }
  return latest
}
