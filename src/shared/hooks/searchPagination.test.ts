import {describe, expect, it} from "vitest"
import {finalizeEvent, generateSecretKey} from "nostr-tools"
import {SearchPageCursor} from "./searchPagination"

const key = generateSecretKey()
const event = (content: string, created_at: number, tags: string[][] = []) =>
  finalizeEvent({kind: 1, content, created_at, tags}, key)

describe("search pagination", () => {
  it("ignores sparse cache and keeps the conservative boundary across relays", () => {
    const page = new SearchPageCursor({kinds: [1], limit: 100, until: 1000})
    page.record(event("cached-february", 10), "cache", true)
    page.record(event("old-source", 100), "sparse-relay")
    page.record(event("recent-raw-nonmatch", 900), "busy-relay")
    expect(page.next()?.until).toBe(900)
  })

  it("does not let an old hashtag result move the recent notes cursor", () => {
    const recent = new SearchPageCursor({limit: 100, until: 1000})
    const tags = new SearchPageCursor({"#t": ["iris"], limit: 100, until: 1000})
    recent.record(event("nonmatch", 900), "relay")
    tags.record(event("old-match", 100, [["t", "iris"]]), "relay")
    recent.advance()
    tags.advance()
    expect(recent.current.until).toBe(900)
    expect(tags.current.until).toBe(100)
  })

  it("keeps timestamp ties and eventually stops empty pages", () => {
    const page = new SearchPageCursor({limit: 2, until: 1000})
    page.record(event("a", 1000), "relay")
    page.record(event("b", 1000), "relay")
    expect(page.next()).toMatchObject({until: 1000, limit: 4})
    page.advance()
    page.record(event("a", 1000), "relay")
    page.record(event("b", 1000), "relay")
    expect(page.next()?.until).toBe(999)
    page.advance()
    expect(page.next()).toBeNull()
  })
})

it("does not let unrelated or out-of-window records establish a history boundary", () => {
  const page = new SearchPageCursor({kinds: [1], "#t": ["iris"], until: 1000, limit: 100})
  page.record(event("unrelated", 100), "relay")
  page.record(event("future", 1001, [["t", "iris"]]), "relay")
  page.record(event("matching", 900, [["t", "iris"]]), "relay")
  expect(page.next()?.until).toBe(900)
})

it("honors explicit since and timestamp zero without inventing older history", () => {
  const page = new SearchPageCursor({kinds: [1], since: 0, until: 0, limit: 100})
  page.record(event("genesis", 0), "relay")
  expect(page.next()).toBeNull()
})

it("keeps a bounded saturated second limited instead of skipping remaining ties", () => {
  const page = new SearchPageCursor({kinds: [1], until: 1000, limit: 1600})
  // Cursor inputs have already passed signature verification at the transport.
  const template = event("timestamp tie", 1000)
  for (let i = 0; i < 1600; i++)
    page.record({...template, id: i.toString(16).padStart(64, "0")}, "relay")
  expect(page.next()).toBeNull()
  expect(page.advance()).toBe(false)
})
