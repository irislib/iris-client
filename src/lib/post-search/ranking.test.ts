import {expect, it} from "vitest"
import {planModelFilters, selectKnownTags} from "./vocabulary"
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

it("searches the requested subject and keeps one recent-note source", () => {
  const query = "Could you show me some cool tech related posts?"
  const plan = planPostSearch(query)
  expect(plan.terms).toEqual(["tech"])
  const filters = buildSearchSubscriptionFilters(
    {kinds: [1], search: query},
    123,
    32,
    plan
  )
  if (!Array.isArray(filters)) throw Error("Expected discovery filters")
  expect(filters.filter((f) => !f.search && !f["#t"])).toHaveLength(1)
  expect(filters.map((f) => f.search).filter(Boolean)).toEqual(["tech"])
  expect(filters.every((f) => f.kinds?.[0] === 1 && f.until === 123)).toBe(true)
  for (const content of ["Cool!", "Tech is cool.", "Thanks for sharing!"]) {
    expect(lexicalMatch(plan, {...note, content})).toBe(-1)
  }
  expect(
    lexicalMatch(plan, {...note, content: "Here is how I built this tech demo."})
  ).toBeGreaterThan(0)
})

it("keeps literal intent, meaningful modifiers and non-English text", () => {
  const cool = {...note, content: "Cool!"}
  expect(lexicalMatch(planPostSearch("cool"), cool)).toBe(1)
  for (const query of [
    "cool jazz",
    "post office",
    "how do I keep my laptop cool",
    "自由軟體",
  ]) {
    expect(planPostSearch(query).modelQuery).toBe(query)
  }
  expect(planPostSearch("post office").terms).toContain("office")
  expect(planPostSearch("#Suomi").hashtags).toEqual(["Suomi"])
  expect(lexicalMatch(planPostSearch("🎷"), {...note, content: "🎷!"})).toBe(1)
})

it("selects distinct words and can abstain when there is no close match", () => {
  const words = ["relay", "source", "hardware", "sail", "song"]
  const index = new Int8Array([100, 0, 98, 12, 92, 40, -10, 98, 5, -100])
  const plan = planPostSearch("relay"),
    query = Float32Array.of(1, 0)
  expect(planModelFilters(plan, words, index, query).terms).toEqual([
    "source",
    "hardware",
  ])
  expect(planModelFilters(plan, ["song"], new Int8Array([-127, 0]), query).terms).toEqual(
    []
  )
  expect(() => planModelFilters(plan, words, new Int8Array(0), query)).toThrow(
    "Invalid keyword index"
  )
})

it("selects the original spelling of a relevant observed tag outside the vocabulary", async () => {
  const query = Float32Array.of(1, 0)
  const tags = await selectKnownTags(
    ["SolarWeaving", "PepperSauce"],
    planPostSearch("solar textile"),
    new Map(),
    query,
    async (text) => (text === "solar weaving" ? query : Float32Array.of(0, 1))
  )
  expect(tags).toEqual(["SolarWeaving"])
})
