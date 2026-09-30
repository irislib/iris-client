import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent, getPublicKey, type Event} from "nostr-tools"
import type {EventFilter, EventSubscription} from "@/lib/nostr"
import {groupTags} from "./model"
import {consolidateGroupLiveFilters, GroupEventCollection} from "./useGroupEvents"

vi.mock("@/lib/nostr", () => ({CacheMode: {PARALLEL: "PARALLEL"}}))
vi.mock("@/utils/nostrClient", () => ({
  nostr: () => {
    throw new Error("Unexpected default transport")
  },
}))
const key = Uint8Array.from({length: 32}, () => 1)
const pub = getPublicKey(key)
const event = (content = "hello", tags: string[][] = []) =>
  finalizeEvent({kind: 1, content, tags, created_at: 900}, key)
class FakeSubscription {
  started = false
  stopped = false
  listeners = new Map<string, (...args: any[]) => void>()
  constructor(
    readonly filters: EventFilter[],
    readonly closeOnEose: boolean
  ) {}
  on(name: string, listener: (...args: any[]) => void) {
    this.listeners.set(name, listener)
  }
  start() {
    this.started = true
  }
  stop() {
    this.stopped = true
  }
  eose() {
    this.listeners.get("eose")?.()
  }
  event(value: Event) {
    this.listeners.get("event")?.({rawEvent: () => value})
  }
}
const harness = () => {
  const subs: FakeSubscription[] = []
  const source = (filters: EventFilter[], closeOnEose: boolean) => {
    const sub = new FakeSubscription(filters, closeOnEose)
    subs.push(sub)
    return sub as unknown as EventSubscription
  }
  return {subs, source}
}
const filters = (count: number) =>
  Array.from({length: count}, (_, i) => ({
    kinds: [1],
    authors: [pub],
    "#p": [String(i)],
    limit: 3,
  }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => {
  vi.useRealTimers()
})

describe("group collection lifecycle", () => {
  it("verifies zap request membership before retention and caps by sender rather than service", () => {
    const {subs, source} = harness()
    const otherKey = Uint8Array.from({length: 32}, () => 2)
    const other = getPublicKey(otherKey)
    const service = Uint8Array.from({length: 32}, () => 3)
    const ref = {creator: pub, id: "00000000-0000-4000-8000-000000000001"}
    const targetId = "f".repeat(64)
    const request = (secret: Uint8Array, time: number) =>
      finalizeEvent(
        {
          kind: 9734,
          content: "",
          created_at: time,
          tags: [["e", targetId], ...groupTags(ref)],
        },
        secret
      )
    const receipt = (request: Event, time: number, indexed = request.pubkey) =>
      finalizeEvent(
        {
          kind: 9735,
          content: "",
          created_at: time,
          tags: [
            ["e", targetId],
            ["P", indexed],
            ["description", JSON.stringify(request)],
          ],
        },
        service
      )
    const collection = new GroupEventCollection(
      [{kinds: [9735], "#e": [targetId], "#P": [pub, other]}],
      2,
      {perAuthorCap: 1, zap: {ref, targetId, authors: [pub, other]}},
      source
    )
    const stop = collection.subscribe(() => {})
    const valid = request(key, 100)
    const forged = {...valid, content: "tampered"}
    subs[0].event(receipt(forged, 110))
    subs[0].event(receipt(request(service, 100), 120, pub))
    vi.advanceTimersByTime(50)
    expect(collection.getSnapshot().events).toHaveLength(0)
    const quiet = receipt(request(otherKey, 100), 130)
    subs[0].event(quiet)
    subs[0].event(receipt(valid, 140))
    subs[0].event(receipt(valid, 141))
    vi.advanceTimersByTime(50)
    expect(collection.getSnapshot().events).toHaveLength(2)
    expect(collection.getSnapshot().limited).toBe(false)
    for (let i = 200; i < 204; i++) subs[0].event(receipt(request(key, i), i + 20))
    vi.advanceTimersByTime(50)
    expect(collection.getSnapshot().events.map((value) => value.id)).toContain(quiet.id)
    expect(collection.getSnapshot().events).toHaveLength(2)
    expect(collection.getSnapshot().limited).toBe(true)
    stop()
  })

  it("starts live before bounded history batches, with at most two history reads", () => {
    const {subs, source} = harness()
    const collection = new GroupEventCollection(filters(40), 200, {}, source)
    expect(collection.getSnapshot().loading).toBe(true)
    const unsubscribe = collection.subscribe(() => {})
    expect(subs.map((sub) => sub.closeOnEose)).toEqual([false, true, true])
    expect(subs.map((sub) => sub.filters.length)).toEqual([1, 16, 16])
    expect(subs[0].filters[0].since).toBe(1000)
    subs[1].eose()
    expect(subs).toHaveLength(4)
    expect(subs[3].filters).toHaveLength(8)
    expect(subs.filter((sub) => sub.closeOnEose && !sub.stopped)).toHaveLength(2)
    subs[2].eose()
    expect(collection.getSnapshot().loading).toBe(true)
    subs[3].eose()
    expect(collection.getSnapshot().loading).toBe(false)
    expect(collection.getSnapshot().error).toBeUndefined()
    unsubscribe()
    expect(subs.every((sub) => sub.stopped)).toBe(true)
  })

  it("deduplicates live/history and rejects expanded live cross-product matches", () => {
    const {subs, source} = harness()
    const originals = filters(17).map((filter, i) => ({...filter, "#e": [String(i)]}))
    const collection = new GroupEventCollection(originals, 200, {}, source)
    const unsubscribe = collection.subscribe(() => {})
    const valid = event("valid", [
      ["p", "0"],
      ["e", "0"],
    ])
    subs[0].event(valid)
    subs[1].event(valid)
    subs[0].event(
      event("cross-product", [
        ["p", "0"],
        ["e", "1"],
      ])
    )
    vi.advanceTimersByTime(50)
    expect(collection.getSnapshot().events.map((value) => value.id)).toEqual([valid.id])
    unsubscribe()
  })

  it("ignores obsolete callbacks and timeouts when the same collection restarts", () => {
    const {subs, source} = harness()
    const collection = new GroupEventCollection([{kinds: [1]}], 20, {}, source)
    const first = collection.subscribe(() => {})
    first()
    const second = collection.subscribe(() => {})
    subs[0].event(event("stale live"))
    subs[1].event(event("stale history"))
    subs[1].eose()
    vi.advanceTimersByTime(50)
    expect(collection.getSnapshot()).toMatchObject({events: [], loading: true})
    const fresh = event("fresh")
    subs[2].event(fresh)
    subs[3].eose()
    vi.advanceTimersByTime(12_000)
    expect(collection.getSnapshot()).toMatchObject({
      events: [fresh],
      loading: false,
    })
    expect(collection.getSnapshot().error).toBeUndefined()
    second()
  })

  it("releases timed out slots, reports incomplete results, and retries cleanly", () => {
    const {subs, source} = harness()
    const collection = new GroupEventCollection(filters(40), 200, {}, source)
    const first = collection.subscribe(() => {})
    vi.advanceTimersByTime(12_000)
    expect(subs).toHaveLength(4)
    expect(subs[1].stopped && subs[2].stopped).toBe(true)
    subs[3].eose()
    expect(collection.getSnapshot().loading).toBe(false)
    expect(collection.getSnapshot().error).toEqual(expect.any(String))
    first()
    const second = collection.subscribe(() => {})
    subs[5].eose()
    subs[6].eose()
    subs[7].eose()
    expect(collection.getSnapshot().loading).toBe(false)
    expect(collection.getSnapshot().error).toBeUndefined()
    second()
  })

  it("recovers from a failed history start and shares ownership until the last reader leaves", () => {
    const {subs, source} = harness()
    let fail = true
    const collection = new GroupEventCollection(
      [{kinds: [1]}],
      20,
      {},
      (batch, close) => {
        if (close && fail) {
          fail = false
          throw new Error("offline")
        }
        return source(batch, close)
      }
    )
    const first = collection.subscribe(() => {})
    const second = collection.subscribe(() => {})
    expect(collection.subscriberCount).toBe(2)
    expect(subs).toHaveLength(1)
    expect(collection.getSnapshot()).toMatchObject({
      loading: false,
      error: expect.any(String),
    })
    first()
    expect(subs[0].stopped).toBe(false)
    second()
    expect(subs[0].stopped).toBe(true)
    const third = collection.subscribe(() => {})
    subs[2].eose()
    expect(collection.getSnapshot().loading).toBe(false)
    expect(collection.getSnapshot().error).toBeUndefined()
    third()
  })

  it("never turns empty author constraints into an unfiltered subscription", () => {
    const {subs, source} = harness()
    const collection = new GroupEventCollection(
      [{kinds: [1], authors: []}],
      20,
      {},
      source
    )
    const unsubscribe = collection.subscribe(() => {})
    expect(subs).toHaveLength(0)
    expect(collection.getSnapshot()).toMatchObject({events: [], loading: false})
    unsubscribe()
    expect(consolidateGroupLiveFilters([{kinds: [1], authors: []}], 1000)).toEqual([])
  })
})
