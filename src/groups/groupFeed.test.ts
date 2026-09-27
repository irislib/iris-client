import {describe, expect, it} from "vitest"
import {diversifyGroupFeed, selectGroupFeedAuthors} from "./groupFeed"

describe("group feed author boundary", () => {
  it("keeps an independently keyed member flood out of the trusted feed", () => {
    const identities = Array.from({length: 1000}, (_, index) => `sybil-${index}`)
    const eligible = new Set(["owner", "trusted", "viewer", ...identities])
    expect(
      selectGroupFeedAuthors(["owner", "trusted"], eligible, "viewer", "trusted")
    ).toEqual(["owner", "trusted", "viewer"])
    expect(
      selectGroupFeedAuthors(["owner", "trusted"], eligible, "viewer", "members")
    ).toHaveLength(1003)
  })

  it("includes the eligible viewer's own posts without promoting them to an authority", () => {
    const authority = new Set(["owner"])
    const eligible = new Set(["owner", "viewer"])
    expect(selectGroupFeedAuthors(authority, eligible, "viewer", "trusted")).toEqual([
      "owner",
      "viewer",
    ])
    expect([...authority]).toEqual(["owner"])
    eligible.delete("viewer")
    expect(selectGroupFeedAuthors(authority, eligible, "viewer", "trusted")).toEqual([
      "owner",
    ])
  })

  it("keeps an empty trusted or member scope explicitly empty", () => {
    expect(
      selectGroupFeedAuthors(["left"], new Set(["outsider"]), null, "trusted")
    ).toEqual([])
    expect(selectGroupFeedAuthors(["left"], new Set(), "left", "members")).toEqual([])
  })
})

describe("group feed diversity", () => {
  it("limits one prolific author while retaining older posts by other selected authors", () => {
    const spam = Array.from({length: 1000}, (_, index) => ({
      id: `spam-${index}`,
      pubkey: "prolific",
    }))
    const quiet = {id: "quiet-post", pubkey: "quiet"}
    expect(diversifyGroupFeed([...spam, quiet], 20)).toEqual([...spam.slice(0, 3), quiet])
  })

  it("preserves chronology and gives each author more room when loading more", () => {
    const events = Array.from({length: 100}, (_, index) => ({
      id: `${index}`,
      pubkey: index % 2 ? "alice" : "bob",
    }))
    const first = diversifyGroupFeed(events, 20)
    const more = diversifyGroupFeed(events, 40)
    expect(first.map((event) => event.id)).toEqual(["0", "1", "2", "3", "4", "5"])
    expect(more.map((event) => event.id)).toEqual(
      events.slice(0, 12).map((event) => event.id)
    )
    expect(diversifyGroupFeed(events, 1000)).toEqual(events)
  })

  it("deduplicates event IDs without spending an author's allowance twice", () => {
    const first = {id: "first", pubkey: "alice"}
    const second = {id: "second", pubkey: "alice"}
    expect(diversifyGroupFeed([first, first, second], 20, 2)).toEqual([first, second])
    expect(diversifyGroupFeed([first], 0)).toEqual([])
  })
})
