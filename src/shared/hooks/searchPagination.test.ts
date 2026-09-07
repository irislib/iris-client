import {describe, expect, it} from "vitest"
import {SearchPageCursor} from "./searchPagination"

describe("search pagination", () => {
  it("ignores sparse cache and keeps the conservative boundary across relays", () => {
    const page = new SearchPageCursor({kinds: [1], limit: 100, until: 1000})
    page.record({id: "cached-february", created_at: 10}, "cache", true)
    page.record({id: "old-source", created_at: 100}, "sparse-relay")
    page.record({id: "recent-raw-nonmatch", created_at: 900}, "busy-relay")
    expect(page.next()?.until).toBe(900)
  })

  it("does not let an old hashtag result move the recent notes cursor", () => {
    const recent = new SearchPageCursor({limit: 100, until: 1000})
    const tags = new SearchPageCursor({"#t": ["iris"], limit: 100, until: 1000})
    recent.record({id: "nonmatch", created_at: 900}, "relay")
    tags.record({id: "old-match", created_at: 100}, "relay")
    recent.advance()
    tags.advance()
    expect(recent.current.until).toBe(900)
    expect(tags.current.until).toBe(100)
  })

  it("keeps timestamp ties and eventually stops empty pages", () => {
    const page = new SearchPageCursor({limit: 2, until: 1000})
    page.record({id: "a", created_at: 1000}, "relay")
    page.record({id: "b", created_at: 1000}, "relay")
    expect(page.next()).toMatchObject({until: 1000, limit: 4})
    page.advance()
    page.record({id: "a", created_at: 1000}, "relay")
    page.record({id: "b", created_at: 1000}, "relay")
    expect(page.next()?.until).toBe(999)
    page.advance()
    expect(page.next()).toBeNull()
  })
})
