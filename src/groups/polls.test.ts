import {describe, expect, it} from "vitest"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {
  createGroupDraft,
  createMembershipDraft,
  createMembershipAttestationDraft,
  groupAddress,
  verifyGroupElectorateEvidence,
} from "./model"
import {
  assertPollSize,
  pollResponseQueries,
  verifyPollAuthority,
  rememberPollRootEvidence,
  buildPollElectorateTags,
  buildPollEvidenceTags,
  tallyPollElectorate,
  buildPollResponseTags,
  buildPollTags,
  parsePoll,
  isPollVoter,
  tallyPollResponses,
  type PollEvent,
} from "./polls"

const hex = (n: number) => n.toString(16).padStart(64, "0")
const pollEvent = (tags: string[][] = []): PollEvent => ({
  id: hex(1),
  pubkey: hex(2),
  kind: 1068,
  created_at: 100,
  content: "What should we build?",
  tags: [
    ["h", "00000000-0000-4000-8000-000000000000"],
    ["a", `37368:${hex(2)}:00000000-0000-4000-8000-000000000000`],
    ["option", "a", "A"],
    ["option", "b", "B"],
    ["endsAt", "200"],
    ...tags,
  ],
})
const response = (overrides: Partial<PollEvent> = {}): PollEvent => ({
  id: hex(3),
  pubkey: hex(4),
  kind: 1018,
  created_at: 150,
  content: "",
  tags: [
    ["e", hex(1)],
    ["response", "a"],
  ],
  ...overrides,
})
const poll = () => parsePoll(pollEvent())!

// NIP-88 responses are signature-verified by the relay layer before this reducer.
describe("NIP-88 polls", () => {
  it("defaults to single choice and parses relay/deadline metadata", () => {
    expect(
      parsePoll(
        pollEvent([
          ["relay", "wss://relay.example"],
          ["relay", "https://example.com"],
        ])
      )
    ).toMatchObject({
      type: "singlechoice",
      endsAt: 200,
      relays: ["wss://relay.example/"],
    })
  })

  it("rejects malformed polls instead of inventing choices or deadlines", () => {
    for (const event of [
      {...pollEvent(), kind: 1},
      {...pollEvent(), id: "not-an-id"},
      {...pollEvent(), content: " "},
      pollEvent([["option", "a", "Duplicate"]]),
      pollEvent([["option", "!", "Invalid ID"]]),
      pollEvent([["polltype", "ranked"]]),
      pollEvent([["polltype"]]),
      pollEvent([["endsAt", "300"]]),
      {...pollEvent(), tags: [["option", "a", "A"]]},
      {
        ...pollEvent(),
        tags: [
          ["option", "a", "A"],
          ["option", "b", "B"],
          ["endsAt", "1e3"],
        ],
      },
      {
        ...pollEvent(),
        tags: [
          ["option", "a", "A"],
          ["option", "b", "B"],
          ["endsAt", "99"],
        ],
      },
    ])
      expect(parsePoll(event)).toBeNull()
  })

  it("uses the first response tag for single choice, even with extra responses", () => {
    const result = tallyPollResponses(
      poll(),
      [
        response({
          tags: [
            ["e", hex(1)],
            ["response", "b"],
            ["response", "a"],
          ],
        }),
      ],
      {now: 180}
    )
    expect(result.counts).toEqual({a: 0, b: 1})
    expect(result.total).toBe(1)
  })

  it("deduplicates selected IDs in multiple choice and uses voters as denominator", () => {
    const multiple = parsePoll(pollEvent([["polltype", "multiplechoice"]]))!
    const result = tallyPollResponses(
      multiple,
      [
        response({
          tags: [
            ["e", hex(1)],
            ["response", "b"],
            ["response", "a"],
            ["response", "b"],
          ],
        }),
      ],
      {now: 180}
    )
    expect(result.counts).toEqual({a: 1, b: 1})
    expect(result.total).toBe(1)
  })

  it("counts the latest valid event per key independently of relay arrival order", () => {
    const old = response()
    const changed = response({
      id: hex(5),
      created_at: 160,
      tags: [
        ["e", hex(1)],
        ["response", "b"],
      ],
    })
    const malformed = response({
      id: hex(6),
      created_at: 170,
      tags: [
        ["e", hex(1)],
        ["response", "missing"],
      ],
    })
    for (const events of [
      [old, changed, malformed],
      [malformed, changed, old, changed],
    ]) {
      const result = tallyPollResponses(poll(), events, {now: 180})
      expect(result.counts).toEqual({a: 0, b: 1})
      expect(result.responsesByPubkey.get(hex(4))?.event.id).toBe(hex(5))
    }
  })

  it("breaks timestamp ties by lowest event ID, without merging distinct keys", () => {
    const a = response({id: hex(8)})
    const b = response({
      id: hex(7),
      tags: [
        ["e", hex(1)],
        ["response", "b"],
      ],
    })
    const otherKey = response({id: hex(9), pubkey: hex(10)})
    for (const events of [
      [a, b, otherKey],
      [otherKey, b, a],
    ]) {
      expect(tallyPollResponses(poll(), events, {now: 180}).counts).toEqual({a: 1, b: 1})
    }
  })

  it("includes timestamps at the deadline, excluding future, early, late and unrelated events", () => {
    const events = [
      response({created_at: 200}),
      response({id: hex(5), pubkey: hex(5), created_at: 99}),
      response({id: hex(6), pubkey: hex(6), created_at: 201}),
      response({id: hex(7), pubkey: hex(7), kind: 1}),
      response({
        id: hex(8),
        pubkey: hex(8),
        tags: [
          ["e", hex(99)],
          ["response", "a"],
        ],
      }),
      response({
        id: hex(9),
        pubkey: hex(9),
        tags: [
          ["e", hex(1)],
          ["e", hex(99)],
          ["response", "a"],
        ],
      }),
      response({id: hex(10), pubkey: hex(10), tags: [["e", hex(1)]]}),
      response({id: hex(11), pubkey: "not-a-key"}),
    ]
    expect(tallyPollResponses(poll(), events, {now: 200}).total).toBe(1)
    expect(tallyPollResponses(poll(), events, {now: 199}).total).toBe(0)
  })

  it("re-evaluates membership from the supplied current policy view", () => {
    const events = [response(), response({id: hex(5), pubkey: hex(5)})]
    expect(
      tallyPollResponses(poll(), events, {now: 180, isEligible: (key) => key === hex(5)})
        .total
    ).toBe(1)
    expect(
      tallyPollResponses(poll(), events, {now: 180, isEligible: () => false}).total
    ).toBe(0)
  })

  it("creates interoperable poll and response tags and validates choices", () => {
    const tags = buildPollTags({
      options: ["  A  ", "B"],
      relays: ["wss://relay.example"],
      endsAt: 200,
    })
    expect(tags).toEqual([
      ["option", "1", "A"],
      ["option", "2", "B"],
      ["polltype", "singlechoice"],
      ["endsAt", "200"],
      ["relay", "wss://relay.example/"],
    ])
    expect(buildPollResponseTags(poll(), ["b"])).toEqual([
      ["e", hex(1)],
      ["response", "b"],
    ])
    expect(() => buildPollResponseTags(poll(), ["a", "b"])).toThrow()
    expect(() => buildPollResponseTags(poll(), [])).toThrow()
    expect(() => buildPollTags({options: ["A", " "], relays: []})).toThrow()
  })
})

const electorate = (): import("./polls").PollElectorate => ({
  rootPubkey: hex(2),
  policyEventId: hex(20),
  policy: {direct: 1, secondDegree: 3},
  memberPubkeys: [hex(2), hex(4), hex(5)],
  authorityPubkeys: [hex(2), hex(4)],
  evidenceEventIds: [hex(20), hex(21)],
  rootFollowEventId: hex(21),
  memberSnapshotLimited: false,
})

describe("frozen poll authority", () => {
  it("round-trips deterministic member, direct-authority and evidence commitments", () => {
    const snapshot = electorate()
    const tags = buildPollElectorateTags(snapshot)
    const reordered = {
      ...snapshot,
      memberPubkeys: [...snapshot.memberPubkeys].reverse(),
      evidenceEventIds: [...snapshot.evidenceEventIds].reverse(),
    }
    expect(buildPollElectorateTags(reordered)).toEqual(tags)
    expect(parsePoll(pollEvent(tags))?.electorate).toEqual(snapshot)
  })

  it("one compromised trusted account has one trusted vote despite ten thousand new keys", () => {
    const snapshotPoll = parsePoll(pollEvent(buildPollElectorateTags(electorate())))!
    const attack = Array.from({length: 10_000}, (_, index) =>
      response({id: hex(index + 100), pubkey: hex(index + 100)})
    )
    const votes = [response(), response({id: hex(30), pubkey: hex(5)}), ...attack]
    const result = tallyPollElectorate(snapshotPoll, votes, 180)
    expect(result.trusted.total).toBe(1)
    expect(result.members.total).toBe(2)
  })

  it("frozen tallies stay stable through membership, follows and policy changes", () => {
    const snapshotPoll = parsePoll(pollEvent(buildPollElectorateTags(electorate())))!
    const votes = [response(), response({id: hex(30), pubkey: hex(5)})]
    const before = tallyPollElectorate(snapshotPoll, votes, 180)
    // Live eligibility may now remove every voter; frozen decisions do not consult it.
    expect(
      tallyPollResponses(snapshotPoll, votes, {now: 180, isEligible: () => false}).total
    ).toBe(0)
    const after = tallyPollElectorate(snapshotPoll, votes, 180)
    expect(after.trusted.counts).toEqual(before.trusted.counts)
    expect(after.members.counts).toEqual(before.members.counts)
  })

  it("replayed keys, shuffled delivery and duplicated events do not increase authority", () => {
    const snapshotPoll = parsePoll(pollEvent(buildPollElectorateTags(electorate())))!
    const old = response()
    const update = response({
      id: hex(40),
      created_at: 160,
      tags: [
        ["e", hex(1)],
        ["response", "b"],
      ],
    })
    for (const votes of [
      [old, update, old, update],
      [update, update, old],
    ]) {
      const result = tallyPollElectorate(snapshotPoll, votes, 180)
      expect(result.trusted.counts).toEqual({a: 0, b: 1})
      expect(result.trusted.total).toBe(1)
    }
  })

  it("rejects malformed, absent, duplicate and oversized snapshot data without truncation", () => {
    const tags = buildPollElectorateTags(electorate())
    expect(
      parsePoll(pollEvent(tags.filter((tag) => tag[0] !== "iris-electorate")))
    ).toBeNull()
    expect(parsePoll(pollEvent([...tags, ["iris-voter", hex(4), "trusted"]]))).toBeNull()
    expect(parsePoll(pollEvent([...tags, ["iris-voter", hex(6), "admin"]]))).toBeNull()
    expect(() =>
      buildPollElectorateTags({...electorate(), authorityPubkeys: [hex(99)]})
    ).toThrow()
    expect(() =>
      buildPollElectorateTags({
        ...electorate(),
        memberPubkeys: Array.from({length: 513}, (_, index) => hex(index + 1)),
      })
    ).toThrow()
    expect(() => assertPollSize({content: "x".repeat(70_000), tags: []})).toThrow()
  })

  it("documents that signed backdated votes remain advisory without receipt witnesses", () => {
    const snapshotPoll = parsePoll(pollEvent(buildPollElectorateTags(electorate())))!
    const observedBeforeClose = tallyPollElectorate(snapshotPoll, [response()], 200)
    const backdated = response({
      id: hex(50),
      created_at: 200,
      tags: [
        ["e", hex(1)],
        ["response", "b"],
      ],
    })
    const observedLater = tallyPollElectorate(snapshotPoll, [response(), backdated], 500)
    expect(observedBeforeClose.trusted.counts).toEqual({a: 1, b: 0})
    expect(observedLater.trusted.counts).toEqual({a: 0, b: 1})
  })
})

describe("poll query isolation", () => {
  it("gives every frozen account its own bounded history filter, so spam cannot crowd peers", () => {
    const frozen = parsePoll(pollEvent(buildPollElectorateTags(electorate())))!
    const query = pollResponseQueries(frozen)
    expect(query.history.flat().map((filter) => filter.authors)).toEqual([
      [hex(2)],
      [hex(4)],
      [hex(5)],
    ])
    expect(query.history.flat().every((filter) => filter.limit === 32)).toBe(true)
    expect(query.live.limit).toBe(0)
    expect(query.live.authors).toEqual([hex(2), hex(4), hex(5)])
  })
})

function signedElectorate() {
  const secret = new Uint8Array(32)
  secret[31] = 1
  const proof = finalizeEvent(
    {kind: 3, created_at: 90, content: "", tags: [["p", hex(4)]]},
    secret
  )
  const snapshot = {
    ...electorate(),
    rootPubkey: proof.pubkey,
    memberPubkeys: [proof.pubkey, hex(4), hex(5)],
    authorityPubkeys: [proof.pubkey, hex(4)],
    evidenceEventIds: [hex(20), proof.id],
    rootFollowEventId: proof.id,
  }
  const draft = pollEvent(buildPollElectorateTags(snapshot))
  draft.pubkey = proof.pubkey
  draft.tags = draft.tags.map((tag) =>
    tag[0] === "a"
      ? ["a", `37368:${proof.pubkey}:00000000-0000-4000-8000-000000000000`]
      : tag
  )
  return {poll: parsePoll(draft)!, proof, secret, draft}
}

describe("signed direct-authority proofs", () => {
  it("accepts authority backed by the creator's own signed contact list", () => {
    const {poll, proof} = signedElectorate()
    expect(verifyPollAuthority(poll, [proof])).toEqual({valid: true})
  })
  it("rejects invented trusted roles, missing proofs and forged contact lists", () => {
    const {poll, proof} = signedElectorate()
    const fabricated = {
      ...poll,
      electorate: {
        ...poll.electorate!,
        authorityPubkeys: [...poll.electorate!.authorityPubkeys, hex(5)],
      },
    }
    expect(verifyPollAuthority(fabricated, [proof]).valid).toBe(false)
    expect(verifyPollAuthority(poll, []).valid).toBe(false)
    const forged = {
      ...proof,
      tags: [
        ["p", hex(4)],
        ["p", hex(5)],
      ],
    }
    expect(verifyPollAuthority(fabricated, [forged]).valid).toBe(false)
  })
  it("rejects rollback when a newer signed contact list was created before opening", () => {
    const {poll, proof, secret} = signedElectorate()
    const newer = finalizeEvent({kind: 3, created_at: 95, content: "", tags: []}, secret)
    expect(verifyPollAuthority(poll, [proof, newer]).valid).toBe(false)
    const later = finalizeEvent({kind: 3, created_at: 150, content: "", tags: []}, secret)
    expect(verifyPollAuthority(poll, [proof, later]).valid).toBe(true)
  })
  it("the poll signature commits the exact roster and evidence", () => {
    const {draft, secret} = signedElectorate()
    const signed = finalizeEvent(
      {kind: 1068, created_at: 100, content: draft.content, tags: draft.tags},
      secret
    )
    const changed = finalizeEvent(
      {
        kind: 1068,
        created_at: 100,
        content: draft.content,
        tags: [...draft.tags, ["iris-evidence", hex(99)]],
      },
      secret
    )
    expect(changed.id).not.toBe(signed.id)
  })
})

describe("bounded snapshot provenance", () => {
  it("preserves an explicitly partial observed member set", () => {
    const snapshot = {...electorate(), memberSnapshotLimited: true}
    expect(
      parsePoll(pollEvent(buildPollElectorateTags(snapshot)))?.electorate
        ?.memberSnapshotLimited
    ).toBe(true)
  })
  it("measures only signed draft fields even when callers hold cyclic NDK state", () => {
    const event = pollEvent(buildPollElectorateTags(electorate()))
    Object.assign(event, {ndk: {event}})
    expect(() => assertPollSize(event)).not.toThrow()
    expect(parsePoll(event)).not.toBeNull()
  })
})

describe("frozen poll voting controls", () => {
  it("retains admitted member control after live membership changes, including zero authority", () => {
    const frozen = parsePoll(pollEvent(buildPollElectorateTags(electorate())))!
    expect(isPollVoter(frozen, hex(5), true, false)).toBe(true)
    expect(isPollVoter(frozen, hex(4), true, false)).toBe(true)
    expect(isPollVoter(frozen, hex(99), true, true)).toBe(false)
    expect(isPollVoter(frozen, hex(4), false, true)).toBe(false)
    expect(isPollVoter(frozen, undefined, true, true)).toBe(false)
    expect(isPollVoter(poll(), hex(4), false, true)).toBe(true)
    expect(isPollVoter(poll(), hex(4), true, false)).toBe(false)
  })
})

function archivedPoll() {
  const rootKey = new Uint8Array(32)
  rootKey[31] = 1
  const memberKey = new Uint8Array(32)
  memberKey[31] = 2
  const ref = {id: "12345678-1234-4234-8234-123456789abc", creator: getPublicKey(rootKey)}
  const member = getPublicKey(memberKey)
  const metadata = finalizeEvent(
    {...createGroupDraft({...ref, name: "Proof archive"}), created_at: 80},
    rootKey
  )
  const contacts = finalizeEvent(
    {kind: 3, content: "", tags: [["p", member]], created_at: 81},
    rootKey
  )
  const join = finalizeEvent(
    {...createMembershipDraft(ref, member, true), created_at: 82},
    memberKey
  )
  const vouch = finalizeEvent(
    {...createMembershipAttestationDraft(ref, member, true), created_at: 83},
    rootKey
  )
  const events = [metadata, contacts, join, vouch]
  const snapshot = {
    rootPubkey: ref.creator,
    policyEventId: metadata.id,
    policy: {direct: 1, secondDegree: 3},
    memberPubkeys: [ref.creator, member],
    authorityPubkeys: [ref.creator, member],
    evidenceEventIds: events.map((event) => event.id),
    rootFollowEventId: contacts.id,
    memberSnapshotLimited: false,
  }
  const tags = [
    ["h", ref.id],
    ["a", groupAddress(ref)],
    ...buildPollTags({options: ["Yes", "No"], endsAt: 200}),
    ...buildPollElectorateTags(snapshot),
    ...buildPollEvidenceTags(snapshot, events),
  ]
  const event = finalizeEvent(
    {kind: 1068, content: "Keep the garden?", tags, created_at: 100},
    rootKey
  )
  return {event, snapshot, events, ref, rootKey}
}

describe("immutable signed proof archive", () => {
  it("replays membership and authority using only the signed poll after relay history disappears", () => {
    const {event, ref} = archivedPoll()
    const parsed = parsePoll(event)!
    expect(parsed.evidenceEvents).toHaveLength(4)
    expect(verifyPollAuthority(parsed, parsed.evidenceEvents!)).toEqual({valid: true})
    expect(
      verifyGroupElectorateEvidence(
        ref,
        parsed.electorate!,
        parsed.evidenceEvents!,
        parsed.createdAt
      )
    ).toEqual({valid: true})
  })
  it("survives later replacement of group policy and creator contacts", () => {
    const {event, ref, rootKey} = archivedPoll()
    const laterPolicy = finalizeEvent(
      {
        ...createGroupDraft({
          ...ref,
          name: "Changed group",
          policy: {direct: 2, secondDegree: 4},
        }),
        created_at: 150,
      },
      rootKey
    )
    const laterContacts = finalizeEvent(
      {kind: 3, content: "", tags: [], created_at: 150},
      rootKey
    )
    const parsed = parsePoll(event)!
    const available = [...parsed.evidenceEvents!, laterPolicy, laterContacts]
    expect(verifyPollAuthority(parsed, available).valid).toBe(true)
    expect(
      verifyGroupElectorateEvidence(ref, parsed.electorate!, available, parsed.createdAt)
        .valid
    ).toBe(true)
  })
  it("rejects missing, forged and duplicate archived proofs", () => {
    const {event} = archivedPoll()
    const bundle = event.tags.find((tag) => tag[0] === "iris-evidence-bundle")!
    const originals = JSON.parse(bundle[2])
    const variants = [
      originals.slice(1),
      [...originals.slice(1), originals[1]],
      originals.map((proof: object, index: number) =>
        index ? proof : {...proof, sig: "0".repeat(128)}
      ),
    ]
    for (const values of variants) {
      const altered = {
        ...event,
        tags: event.tags.map((tag) =>
          tag === bundle ? [tag[0], tag[1], JSON.stringify(values)] : tag
        ),
      }
      expect(parsePoll(altered)).toBeNull()
    }
  })
  it("refuses missing or oversized evidence without dropping voters or signatures", () => {
    const {snapshot, events, rootKey} = archivedPoll()
    expect(() => buildPollEvidenceTags(snapshot, events.slice(1))).toThrow()
    const large = finalizeEvent(
      {kind: 3, content: "x".repeat(70_000), tags: [], created_at: 90},
      rootKey
    )
    expect(() =>
      buildPollEvidenceTags(
        {...snapshot, evidenceEventIds: [...snapshot.evidenceEventIds, large.id]},
        [...events, large]
      )
    ).toThrow(/size limit/)
  })
})

describe("proof refresh conflict retention", () => {
  it("keeps a valid pre-opening root-list conflict after an empty or forged refresh", () => {
    const {poll, proof, secret} = signedElectorate()
    const newer = finalizeEvent({kind: 3, content: "", tags: [], created_at: 95}, secret)
    const remembered = rememberPollRootEvidence(poll, undefined, [newer])
    const afterTimeout = rememberPollRootEvidence(poll, remembered, [])
    const afterForged = rememberPollRootEvidence(poll, afterTimeout, [
      {...proof, created_at: 99},
    ])
    expect(afterForged?.id).toBe(newer.id)
    expect(verifyPollAuthority(poll, [proof, afterForged!]).valid).toBe(false)
  })
})
