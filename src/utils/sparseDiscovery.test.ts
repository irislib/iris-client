import {describe, expect, it} from "vitest"
import {SocialGraph} from "nostr-social-graph"
import type {Event} from "nostr-tools"
import {selectSparseDiscoveryAuthors, selectSparseDiscoveryPosts} from "./sparseDiscovery"

const key = (n: number) => n.toString(16).padStart(64, "0")
const note = (id: number, author = 20, tags: string[][] = [], content = "original") =>
  ({
    id: key(id),
    pubkey: key(author),
    created_at: id,
    kind: 1,
    tags,
    content,
    sig: "f".repeat(128),
  }) as Event

describe("sparse discovery bounds", () => {
  it("balances direct trust branches, excludes hidden/direct/distant users, and gates raw follows", async () => {
    const graph = new SocialGraph(key(1))
    graph.addFollower(key(1), key(2))
    graph.addFollower(key(1), key(3))
    for (const n of [10, 11, 12, 13, 14, 15, 16, 17]) graph.addFollower(key(2), key(n))
    for (const n of [10, 18, 19]) graph.addFollower(key(3), key(n))
    graph.addFollower(key(10), key(30))
    await graph.recalculateFollowDistances()
    const visibility = {
      shouldHideRecommendationUser: (k: string) => k === key(11),
      shouldHideAlgorithmicEvent: () => false,
    }
    const authors = selectSparseDiscoveryAuthors(graph, visibility, key(1), key(1))
    expect(authors).toEqual([10, 18, 12, 19, 13, 14, 15, 16].map(key))
    expect(new Set(authors).size).toBe(8)
    graph.addFollower(key(1), key(4))
    graph.addFollower(key(1), key(5))
    expect(selectSparseDiscoveryAuthors(graph, visibility, key(1))).toEqual([])
  })

  it("spends the eight-per-author sample on replies before filtering and keeps mentions/quotes", () => {
    const replies = Array.from({length: 8}, (_, i) =>
      note(100 + i, 20, [["e", key(1), "", "reply"]])
    )
    const quote = note(20, 21, [["q", key(1)]])
    const mention = note(21, 21, [["e", key(1), "", "mention"]])
    expect(
      selectSparseDiscoveryPosts(
        [key(20), key(21)],
        [note(1), ...replies, quote, mention]
      )
    ).toEqual([mention, quote])
  })

  it("deduplicates before budgets and returns at most two originals per author in rounds", () => {
    const a = note(1),
      b = note(2),
      c = note(3),
      d = note(4, 21),
      e = note(5, 21)
    expect(selectSparseDiscoveryPosts([key(20), key(21)], [a, c, c, b, d, e])).toEqual([
      c,
      e,
      b,
      d,
    ])
  })

  it("enforces signed JSON byte costs before reply filtering and excludes runtime fields", () => {
    const hugeReply = note(2, 20, [["e", key(1), "", "root"]], "💜".repeat(17000))
    expect(
      selectSparseDiscoveryPosts([key(20), key(21)], [hugeReply, note(3, 21)])
    ).toEqual([])
    const original = Object.assign(note(1), {
      relay: {hugeRuntimeData: "x".repeat(100000)},
    })
    expect(selectSparseDiscoveryPosts([key(20)], [original])).toEqual([original])
  })
})
