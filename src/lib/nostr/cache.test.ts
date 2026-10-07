import {afterEach, expect, it, vi} from "vitest"
import {EventCache} from "./cache"
import {db} from "./db"
import type {Event} from "nostr-tools"

const cache = new EventCache()
const hex = (n: number) => n.toString(16).padStart(64, "0")
const event = (id: number, pubkey: string, kind: number, created_at: number): Event => ({
  id: hex(id),
  pubkey,
  kind,
  created_at,
  tags: [],
  content: "retained-cache-fixture",
  sig: "00".repeat(64),
})
const save = async (events: Event[]) =>
  db.events.bulkPut(
    events.map((e) => ({
      id: e.id,
      pubkey: e.pubkey,
      kind: e.kind,
      createdAt: e.created_at,
      event: JSON.stringify(e),
      tagIndex: [],
    }))
  )

afterEach(async () => {
  vi.restoreAllMocks()
  await db.events.clear()
})

it("reads only the requested recent history across many authors and kinds", async () => {
  const authors = Array.from({length: 100}, (_, i) => hex(i + 1))
  const old = Array.from({length: 3000}, (_, i) =>
    event(i + 1, authors[i % authors.length], i % 2 ? 1 : 30023, i)
  )
  const recent = Array.from({length: 40}, (_, i) =>
    event(i + 4000, authors[i % authors.length], i % 2 ? 1 : 30023, 10000 + i)
  )
  await save([...old, ...recent])
  const originalParse = JSON.parse
  let decoded = 0
  vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => {
    if (typeof text === "string" && text.includes("retained-cache-fixture")) decoded++
    return originalParse(text, reviver)
  })
  const result = await cache.store.query([
    {authors, kinds: [1, 30023], since: 10000, until: 10035, limit: 10},
  ])
  expect(result.map((e) => e.id)).toEqual(
    recent
      .slice(26, 36)
      .reverse()
      .map((e) => e.id)
  )
  // A bounded history lookup must not deserialize thousands of older posts.
  expect(decoded).toBeLessThan(100)
})

it("keeps OR-filter limits, authors, tags, and timestamp boundaries", async () => {
  const events = [
    event(1, hex(10), 1, 100),
    event(2, hex(11), 7, 101),
    event(3, hex(10), 1, 102),
  ]
  events[0].tags = [["t", "test"]]
  await save(events)
  await db.events.update(events[0].id, {tagIndex: ["t:test"]})
  expect(
    (
      await cache.store.query([
        {authors: [hex(10), hex(11)], kinds: [1, 7], since: 100, until: 101, limit: 1},
        {ids: [events[2].id]},
      ])
    ).map((e) => e.id)
  ).toEqual([events[2].id, events[1].id])
  expect(
    (await cache.store.query([{authors: [hex(10)], kinds: [1, 7], "#t": ["test"]}])).map(
      (e) => e.id
    )
  ).toEqual([events[0].id])
})
