import {expect, it} from "vitest"
import {
  authorSignal,
  lexicalMatch,
  planPostSearch,
  postRelevance,
  rankCandidates,
} from "./ranking"
import {buildSearchSubscriptionFilters} from "@/shared/hooks/buildSearchSubscriptionFilters"
const note = {
  id: "a",
  pubkey: "author",
  created_at: 1,
  content: "Baking sourdough bread at home.",
  tags: [["t", "Baking"]],
}
it("bounds relay requests for descriptions and keeps explicit hashtags mandatory", () => {
  const plan = planPostSearch(
    "Please find a post about baking sourdough bread at home in a Dutch oven #Baking"
  )
  expect(plan.anchors).toContain("sourdough")
  const filters = buildSearchSubscriptionFilters(
    {kinds: [1], search: plan.text, authors: ["a"]},
    123,
    32,
    plan
  )
  expect(Array.isArray(filters)).toBe(true)
  if (!Array.isArray(filters)) throw Error("Expected discovery filters")
  expect(filters.length).toBeLessThanOrEqual(7)
  expect(
    filters.every((f) => f.limit === 32 && f.until === 123 && f.authors?.[0] === "a")
  ).toBe(true)
  expect(lexicalMatch(plan, note)).toBeGreaterThan(0)
  expect(postRelevance(lexicalMatch(plan, {...note, tags: []}), 1, 1, 0)).toBe(-Infinity)
})
it("uses network position, known followers and freshness only for topical posts", () => {
  const near = authorSignal(1, 10),
    far = authorSignal(3, 10)
  expect(near).toBeGreaterThan(far)
  expect(authorSignal(2, 12)).toBeGreaterThan(authorSignal(2, 1))
  expect(postRelevance(1, 0.9, near, 1)).toBeGreaterThan(postRelevance(1, 0.9, far, 1))
  expect(postRelevance(1, 0.9, near, 1)).toBeGreaterThan(postRelevance(1, 0.9, near, 90))
  expect(postRelevance(0, 0, near, 0)).toBe(-Infinity)
})
it("shows the best match per author and excludes unrelated notes from the expansion", () => {
  const rows = [0.5, 1, 0].map((lexical, i) => ({
    event: {...note, id: String(i)},
    lexical,
    author: 1,
  }))
  const ranked = rankCandidates(rows, new Map(), 100)
  expect(ranked.primary.map((e) => e.id)).toEqual(["1"])
  expect(ranked.additional.get("author")?.map((e) => e.id)).toEqual(["0"])
})
