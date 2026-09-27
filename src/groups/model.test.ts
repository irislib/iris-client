import {finalizeEvent, getPublicKey, type EventTemplate} from "nostr-tools"
import {describe, expect, it} from "vitest"
import {
  createGroupDraft,
  createMembershipDraft,
  createVouchDraft,
  deriveGroupMembers,
  deriveGroupElectorate,
  groupAddress,
  listGroups,
  parseGroup,
  parseGroupEventState,
  protectedGroupFactFilters,
  verifyGroupElectorateEvidence,
  type GroupRef,
} from "./model"

const key = (n: number) => {
  const bytes = new Uint8Array(32)
  new DataView(bytes.buffer).setUint32(28, n)
  return bytes
}
const pub = (n: number) => getPublicKey(key(n))
const ref: GroupRef = {
  id: "12345678-1234-4234-8234-123456789abc",
  creator: pub(1),
}
const sign = (draft: Omit<EventTemplate, "created_at">, n = 1, time = 100) =>
  finalizeEvent({...draft, created_at: time}, key(n))
const metadata = sign(createGroupDraft({...ref, name: "Garden"}))
const group = parseGroup(metadata, 200)!
const join = (n: number, time = 100, joined = true) =>
  sign(createMembershipDraft(ref, pub(n), joined), n, time)
const vouch = (author: number, member: number, time = 100, active = true) =>
  sign(createVouchDraft(ref, pub(member), active), author, time)
const derive = (
  events: ReturnType<typeof sign>[],
  follows: Record<string, string[]> = {}
) => deriveGroupMembers({group, events, now: 200, getFollows: (p) => follows[p] ?? []})

describe("group facts and membership", () => {
  it("round trips signed metadata and scopes it to a creator address", () => {
    expect(group).toMatchObject({...ref, name: "Garden"})
    expect(groupAddress(group)).toBe(`37368:${pub(1)}:${ref.id}`)
    const impersonation = sign(createGroupDraft({...ref, name: "Fake"}), 2, 110)
    expect(parseGroup(impersonation, 200)).toBeNull()
    expect(listGroups([metadata, impersonation], 200)).toEqual([group])
    expect(parseGroup({...metadata, content: "tampered"}, 200)).toBeNull()
    const badSignature = JSON.parse(JSON.stringify(metadata))
    badSignature.sig = "0".repeat(128)
    expect(parseGroup(badSignature, 200)).toBeNull()
    expect(parseGroup({...metadata, sig: "0".repeat(128)}, 200)).toBeNull()
  })

  it("bootstraps creator consent but metadata edits do not undo a leave", () => {
    expect(derive([]).byPubkey.get(pub(1))?.eligible).toBe(true)
    const edited = sign(createGroupDraft({...ref, name: "New name"}), 1, 190)
    const afterLeave = deriveGroupMembers({
      group: parseGroup(edited, 200)!,
      events: [join(1, 110, false)],
      now: 200,
      getFollows: () => [],
    })
    expect(afterLeave.byPubkey.get(pub(1))).toMatchObject({
      joined: false,
      eligible: false,
    })
  })

  it("requires member consent and direct trust, and never counts self vouches", () => {
    const follows = {[pub(1)]: [pub(2), pub(3)]}
    expect(derive([vouch(1, 2)], follows).byPubkey.get(pub(2))?.eligible).toBe(false)
    expect(derive([join(2), vouch(2, 2)], follows).byPubkey.get(pub(2))?.eligible).toBe(
      false
    )
    expect(derive([join(2), vouch(1, 2)], follows).byPubkey.get(pub(2))?.eligible).toBe(
      true
    )
    const states = derive([join(2), join(3), vouch(1, 3), vouch(3, 2)], follows)
    expect(states.byPubkey.get(pub(2))).toMatchObject({eligible: true, directVouches: 1})
    expect(
      derive([join(2), join(2, 150, false), vouch(1, 2)], follows).byPubkey.get(pub(2))
    ).toMatchObject({joined: false, eligible: false})
  })

  it("does not accept consent signed by somebody else or alias unrelated keys", () => {
    const forgedConsent = sign(createMembershipDraft(ref, pub(2), true), 3)
    expect(derive([forgedConsent, vouch(1, 2)]).byPubkey.get(pub(2))?.joined).toBe(false)
    const aliased = createMembershipDraft(ref, pub(2), true)
    aliased.tags = aliased.tags.map((tag) =>
      tag[0] === "controls" ? ["controls", pub(3)] : tag
    )
    expect(derive([sign(aliased, 3), vouch(1, 3)]).byPubkey.get(pub(3))?.joined).toBe(
      false
    )
  })

  it("uses deterministic withdrawals independent of delivery order", () => {
    const grant = vouch(1, 2)
    const revoke = vouch(1, 2, 150, false)
    for (const events of [
      [join(2), grant, revoke],
      [revoke, grant, join(2)],
    ]) {
      expect(derive(events).byPubkey.get(pub(2))).toMatchObject({
        eligible: false,
        vouchers: [],
      })
    }
    const tieGrant = vouch(1, 2, 150)
    const expected = tieGrant.id < revoke.id
    expect(derive([join(2), revoke, tieGrant]).byPubkey.get(pub(2))?.eligible).toBe(
      expected
    )
    expect(derive([join(2), tieGrant, revoke]).byPubkey.get(pub(2))?.eligible).toBe(
      expected
    )
  })

  it("ignores future facts and prevents expired latest claims resurrecting old claims", () => {
    expect(derive([join(2), vouch(1, 2, 201)]).byPubkey.get(pub(2))?.eligible).toBe(false)
    const expiring = createVouchDraft(ref, pub(2), true)
    expiring.tags.push(["expiration", "180"])
    const events = [join(2), vouch(1, 2), sign(expiring, 1, 150)]
    expect(derive(events).byPubkey.get(pub(2))?.eligible).toBe(false)
    const invalid = createVouchDraft(ref, pub(2), true)
    invalid.tags.push(["expiration", "not-a-date"])
    expect(derive([join(2), sign(invalid)]).byPubkey.get(pub(2))?.eligible).toBe(false)
  })

  it("counts independent second-degree routes, not a Sybil fan-out through one contact", () => {
    const events = [
      join(2),
      join(5),
      join(6),
      join(7),
      vouch(1, 5),
      vouch(1, 6),
      vouch(1, 7),
      vouch(5, 2),
      vouch(6, 2),
      vouch(7, 2),
    ]
    const shared = {[pub(1)]: [pub(3)], [pub(3)]: [pub(5), pub(6), pub(7)]}
    expect(derive(events, shared).byPubkey.get(pub(2))).toMatchObject({
      eligible: false,
      secondDegreeVouches: 1,
    })
    const independent = {
      [pub(1)]: [pub(3), pub(4), pub(8)],
      [pub(3)]: [pub(5), pub(6)],
      [pub(4)]: [pub(5)],
      [pub(8)]: [pub(7)],
    }
    expect(derive(events, independent).byPubkey.get(pub(2))).toMatchObject({
      eligible: true,
      secondDegreeVouches: 3,
    })
  })

  it("does not count a member as their own trust bridge or count a departed voucher", () => {
    const follows = {[pub(1)]: [pub(2)], [pub(2)]: [pub(3), pub(4), pub(5)]}
    const events = [join(2), ...[3, 4, 5].flatMap((n) => [join(n), vouch(n, 2)])]
    expect(derive(events, follows).byPubkey.get(pub(2))?.secondDegreeVouches).toBe(0)
    expect(
      derive([join(2), join(3), join(3, 150, false), vouch(3, 2)], {
        [pub(1)]: [pub(3)],
      }).byPubkey.get(pub(2))?.eligible
    ).toBe(false)
  })

  it("isolates a reused group UUID and validates contradictory or malformed facts", () => {
    const other = {...ref, creator: pub(3)}
    const wrongGroup = sign(createVouchDraft(other, pub(2), true), 1)
    expect(derive([join(2), wrongGroup]).byPubkey.get(pub(2))?.eligible).toBe(false)
    const contradictory = createVouchDraft(ref, pub(2), true)
    contradictory.tags.push(["not_member_of", ref.id, ref.creator])
    expect(derive([join(2), sign(contradictory)]).byPubkey.get(pub(2))?.eligible).toBe(
      false
    )
  })

  it("uses the chosen personal root without changing the creator's default policy", () => {
    const events = [join(2), join(3), vouch(1, 3), vouch(3, 2)]
    const result = deriveGroupMembers({
      group,
      events,
      view: "personal",
      viewer: pub(4),
      now: 200,
      getFollows: (p) => (p === pub(4) ? [pub(1), pub(3)] : []),
    })
    expect(result.rootPubkey).toBe(pub(4))
    expect(result.byPubkey.get(pub(2))?.eligible).toBe(true)
    expect(derive(events).byPubkey.get(pub(2))?.eligible).toBe(false)
  })

  it("requires eligible vouchers and recomputes from the creator after withdrawals", () => {
    const events = [join(2), join(3), vouch(2, 3), vouch(3, 2)]
    const follows = {[pub(1)]: [pub(2), pub(3)]}
    expect(derive(events, follows).eligiblePubkeys).toEqual(new Set([pub(1)]))
    expect(derive([...events, vouch(1, 2)], follows).eligiblePubkeys).toEqual(
      new Set([pub(1), pub(2), pub(3)])
    )
    expect(
      derive([...events, vouch(1, 2), vouch(1, 2, 150, false)], follows).eligiblePubkeys
    ).toEqual(new Set([pub(1)]))
    expect(
      derive([...events, vouch(1, 2), join(1, 150, false)], follows).eligiblePubkeys.size
    ).toBe(0)
  })

  it("bounds graph traversal and reports incomplete network data", () => {
    let visited = 0
    const repeated = pub(3)
    function* endless() {
      for (;;) {
        visited++
        yield repeated
      }
    }
    const result = deriveGroupMembers({
      group,
      events: [join(2)],
      now: 200,
      getFollows: endless,
    })
    expect(visited).toBeLessThan(20000)
    expect(result.truncated).toBe(true)
    expect(() =>
      deriveGroupElectorate({group, events: [], now: 200, getFollows: endless})
    ).toThrow("complete trust view")
  })

  it("pins eligible members and nondelegated authority in the creator's poll view", () => {
    const events = [join(2), join(3), vouch(1, 3), vouch(3, 2)]
    const follows = (p: string) => (p === pub(1) ? [pub(3)] : [])
    const electorate = deriveGroupElectorate({
      group,
      events,
      now: 200,
      getFollows: follows,
      view: "personal",
      viewer: pub(2),
      policy: {direct: 20, secondDegree: 20},
    })
    expect(electorate.memberPubkeys).toEqual([pub(1), pub(2), pub(3)].sort())
    expect(electorate.authorityPubkeys).toEqual([pub(1), pub(3)].sort())
    expect(electorate.rootPubkey).toBe(pub(1))
    expect(electorate.policy).toEqual(group.policy)
    expect(electorate.policyEventId).toBe(group.eventId)
    expect(electorate.evidenceEventIds).toEqual(
      [group.eventId, ...events.map((e) => e.id)].sort()
    )
  })

  it("does not let a compromised trusted member mint authority through 1000 admissions", () => {
    const events = [join(3), vouch(1, 3)]
    const bots: string[] = []
    for (let n = 100; n < 1100; n++) {
      bots.push(pub(n))
      events.push(join(n), vouch(3, n))
    }
    const getFollows = (p: string) => (p === pub(1) ? [pub(3)] : [])
    const members = deriveGroupMembers({group, events, now: 200, getFollows})
    // Membership fan-out remains visible; it never silently becomes authority.
    expect(members.eligiblePubkeys.size).toBe(1002)
    expect(members.authorityPubkeys).toEqual(new Set([pub(1), pub(3)]))
    expect(bots.filter((p) => members.authorityPubkeys.has(p))).toHaveLength(0)
    const snapshot = deriveGroupElectorate({
      group,
      events,
      now: 200,
      getFollows,
      viewer: pub(1000),
    })
    expect(snapshot.memberPubkeys).toHaveLength(512)
    expect(snapshot.memberSnapshotLimited).toBe(true)
    expect(snapshot.authorityPubkeys).toEqual([pub(1), pub(3)].sort())
    expect(snapshot.memberPubkeys).toContain(pub(1000))
    expect(snapshot.evidenceEventIds.length).toBeLessThan(2048)
  }, 30_000)

  it("collapses only valid semantic states and gives each protected author a relay limit", () => {
    const active = vouch(1, 2)
    const inactive = vouch(1, 2, 150, false)
    expect(parseGroupEventState(active, 200)?.key).toBe(
      parseGroupEventState(inactive, 200)?.key
    )
    expect(parseGroupEventState(join(2), 200)?.key).not.toBe(
      parseGroupEventState(active, 200)?.key
    )
    const expiring = createVouchDraft(ref, pub(2), true)
    expiring.tags.push(["expiration", "160"])
    expect(parseGroupEventState(sign(expiring, 1, 150), 200)?.key).toBe(
      parseGroupEventState(active, 200)?.key
    )
    const malformed = {...active, tags: [...active.tags, ["controls", pub(3)]]}
    expect(parseGroupEventState(malformed, 200)).toBeNull()
    const filters = protectedGroupFactFilters(ref, [pub(1), pub(2)])
    expect(filters).toHaveLength(4)
    expect(
      filters.every((filter) => filter.authors?.length === 1 && filter.limit! > 0)
    ).toBe(true)
    expect(filters.every((filter) => filter["#a"]?.[0] === groupAddress(ref))).toBe(true)
  })
})

describe("poll electorate evidence", () => {
  const fixture = () => {
    const facts = [join(2), join(3), vouch(1, 3), vouch(3, 2)]
    const contacts = sign({kind: 3, content: "", tags: [["p", pub(3)]]})
    const snapshot = deriveGroupElectorate({
      group,
      events: facts,
      now: 200,
      getFollows: (p) => (p === pub(1) ? [pub(3)] : []),
    })
    snapshot.rootFollowEventId = contacts.id
    snapshot.evidenceEventIds.push(contacts.id)
    return {snapshot, facts, contacts, events: [metadata, ...facts, contacts]}
  }

  it("replays real signed consent, vouches, group policy and the root's contact list", () => {
    const {snapshot, events} = fixture()
    expect(verifyGroupElectorateEvidence(ref, snapshot, events, 200)).toEqual({
      valid: true,
    })
  })

  it("rejects an invented member and an unrelated signed group policy", () => {
    const {snapshot, events} = fixture()
    expect(
      verifyGroupElectorateEvidence(
        ref,
        {...snapshot, memberPubkeys: [...snapshot.memberPubkeys, pub(4)]},
        events,
        200
      ).valid
    ).toBe(false)
    const other = sign(
      createGroupDraft({
        ...ref,
        id: "12345678-1234-4234-8234-123456789abd",
        name: "Other",
      })
    )
    expect(
      verifyGroupElectorateEvidence(
        ref,
        {
          ...snapshot,
          policyEventId: other.id,
          evidenceEventIds: snapshot.evidenceEventIds.map((id) =>
            id === metadata.id ? other.id : id
          ),
        },
        [other, ...events],
        200
      ).valid
    ).toBe(false)
  })

  it("rejects missing consent even when the poll author omits its evidence commitment", () => {
    const {snapshot, events, facts} = fixture()
    const consentId = facts[0].id
    const remaining = events.filter((event) => event.id !== consentId)
    expect(verifyGroupElectorateEvidence(ref, snapshot, remaining, 200).valid).toBe(false)
    expect(
      verifyGroupElectorateEvidence(
        ref,
        {
          ...snapshot,
          evidenceEventIds: snapshot.evidenceEventIds.filter((id) => id !== consentId),
        },
        remaining,
        200
      ).valid
    ).toBe(false)
  })

  it("rejects a forged vouch even when it carries a copied verified-event cache marker", () => {
    const {snapshot, events, facts} = fixture()
    const forged = {...facts[3], sig: "0".repeat(128)}
    const supplied = events.map((event) => (event.id === forged.id ? forged : event))
    expect(verifyGroupElectorateEvidence(ref, snapshot, supplied, 200).valid).toBe(false)
  })

  it("requires signed direct authority and rejects known preopening root-list rollback", () => {
    const {snapshot, events} = fixture()
    expect(
      verifyGroupElectorateEvidence(
        ref,
        {...snapshot, rootFollowEventId: undefined},
        events,
        200
      ).valid
    ).toBe(false)
    expect(
      verifyGroupElectorateEvidence(
        ref,
        {...snapshot, authorityPubkeys: [...snapshot.authorityPubkeys, pub(2)]},
        events,
        200
      ).valid
    ).toBe(false)
    const later = sign({kind: 3, content: "", tags: []}, 1, 150)
    expect(
      verifyGroupElectorateEvidence(ref, snapshot, [...events, later], 200).valid
    ).toBe(false)
    expect(
      verifyGroupElectorateEvidence(
        ref,
        snapshot,
        [...events, sign({kind: 3, content: "", tags: []}, 1, 201)],
        200
      ).valid
    ).toBe(true)
  })
})
