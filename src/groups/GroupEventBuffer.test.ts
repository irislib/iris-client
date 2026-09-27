import {finalizeEvent, getPublicKey, type EventTemplate} from "nostr-tools"
import {describe, expect, it} from "vitest"
import {GroupEventBuffer} from "./GroupEventBuffer"
import {
  createGroupDraft,
  createMembershipDraft,
  createMembershipAttestationDraft,
} from "./model"

const key = (n: number) => Uint8Array.from({length: 32}, () => n)
const pub = (n: number) => getPublicKey(key(n))
const ref = {id: "12345678-1234-4234-8234-123456789abc", creator: pub(1)}
const sign = (draft: Omit<EventTemplate, "created_at">, n = 1, created_at = 100) =>
  finalizeEvent({...draft, created_at}, key(n))
const note = (n: number, created_at: number) =>
  sign({kind: 1, content: String(created_at), tags: []}, n, created_at)
const buffer = (capacity = 8, perAuthorCap = capacity, factTargets?: string[]) =>
  new GroupEventBuffer({capacity, perAuthorCap, factTargets, now: () => 1000})

describe("bounded group event retention", () => {
  it("rejects unknown authors at saturation before reading signed fields", () => {
    const store = buffer(1)
    store.add(note(1, 100))
    const newcomer = note(2, 200)
    Object.defineProperty(newcomer, "content", {
      get: () => {
        throw new Error("must not verify rejected newcomer")
      },
    })
    expect(store.add(newcomer)).toBe(false)
    expect(store.limited).toBe(true)
    const update = note(1, 300)
    expect(store.add(update)).toBe(true)
    expect(store.getEvents().map((event) => event.id)).toEqual([update.id])
  })

  it("collapses current fact states, including a latest expired withdrawal", () => {
    const store = buffer(2)
    const active = sign(createMembershipAttestationDraft(ref, pub(2), true))
    const expired = createMembershipAttestationDraft(ref, pub(2), false)
    expired.tags.push(["expiration", "250"])
    const latest = sign(expired, 1, 200)
    expect(store.add(active)).toBe(true)
    expect(store.add(latest)).toBe(true)
    expect(store.add(active)).toBe(false)
    expect(store.getEvents().map((event) => event.id)).toEqual([latest.id])
    expect(store.limited).toBe(false)
  })

  it("replaces contact lists and group metadata at full capacity", () => {
    const store = buffer(2)
    store.add(sign({kind: 3, content: "", tags: []}))
    store.add(sign(createGroupDraft({...ref, name: "Garden"})))
    const contacts = sign({kind: 3, content: "", tags: [["p", pub(2)]]}, 1, 200)
    const metadata = sign(createGroupDraft({...ref, name: "New Garden"}), 1, 201)
    expect(store.add(contacts)).toBe(true)
    expect(store.add(metadata)).toBe(true)
    expect(store.size).toBe(2)
    expect(store.limited).toBe(false)
    expect(store.getEvents().map((event) => event.id)).toEqual([metadata.id, contacts.id])
  })

  it("never lets a flooding author evict another author's retained evidence", () => {
    const store = buffer(4, 2)
    const quiet = note(2, 100)
    store.add(quiet)
    for (let time = 200; time < 206; time++) store.add(note(1, time))
    expect(store.getEvents().map((event) => event.id)).toContain(quiet.id)
    expect(store.getEvents().filter((event) => event.pubkey === pub(1))).toHaveLength(2)
    expect(store.limited).toBe(true)
    expect(store.size).toBe(3)
    store.add(note(3, 300))
    expect(store.add(note(4, 400))).toBe(false)
    expect(store.size).toBe(4)
  })

  it("rejects malformed signed facts and cached-signature forgeries before capacity", () => {
    const store = buffer(1)
    expect(store.add(sign({kind: 7368, content: "{}", tags: []}))).toBe(false)
    expect(store.add(sign({kind: 37368, content: "{}", tags: []}))).toBe(false)
    const valid = note(1, 100)
    expect(store.add({...valid, content: "forged"})).toBe(false)
    expect(store.add({...valid, sig: "0".repeat(128)})).toBe(false)
    expect(store.size).toBe(0)
    expect(store.limited).toBe(false)
    expect(store.add(valid)).toBe(true)
  })

  it("matches the parsed subject, not an extra tag claiming a protected target", () => {
    const store = buffer(4, 4, [pub(2)])
    const mismatch = createMembershipAttestationDraft(ref, pub(3), true)
    mismatch.tags.push(["p", pub(2)])
    expect(store.add(sign(mismatch))).toBe(false)
    expect(store.add(sign(createMembershipAttestationDraft(ref, pub(2), true)))).toBe(
      true
    )
    expect(store.add(sign(createMembershipDraft(ref, pub(2), true), 2))).toBe(true)
    expect(store.size).toBe(2)
  })

  it("keeps owned protocol data and stable snapshots until a real change", () => {
    const store = buffer()
    const event = note(1, 100)
    store.add(event)
    const snapshot = store.getEvents()
    expect(store.getEvents()).toBe(snapshot)
    expect(store.add(event)).toBe(false)
    expect(store.getEvents()).toBe(snapshot)
    event.content = "mutated"
    event.tags.push(["a", "forged"])
    expect(snapshot[0].content).toBe("100")
    expect(snapshot[0].tags).toEqual([])
    expect(store.add(event)).toBe(false)
    store.clear()
    expect(store.size).toBe(0)
    expect(store.getEvents()).toEqual([])
  })
})
