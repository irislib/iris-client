import {expect, it, vi} from "vitest"
import {SocialGraph} from "nostr-social-graph"
import {createLikeOrder} from "./likeOrder"

it("caches scores per graph revision, ignores self-endorsements and keeps unreachable people last", () => {
  const labels = ["amber", "ash", "away", "birch", "cedar", "viewer"]
  const key = (label: string) =>
    (labels.indexOf(label) + 1).toString(16).padStart(64, "0")
  const graph = new SocialGraph(key("viewer"))
  const contacts = (pubkey: string, names: string[], time = 1) =>
    graph.handleEvent({
      kind: 3,
      id: pubkey + time,
      pubkey: key(pubkey),
      content: "",
      sig: "",
      created_at: time,
      tags: names.map((name) => ["p", key(name)]),
    })
  contacts("viewer", ["viewer", "amber", "birch", "cedar"])
  contacts("cedar", ["cedar", "ash"])
  contacts("birch", ["amber"])
  const entries = ["away", "ash", "cedar", "amber", "birch", "viewer"].map((pubkey) => ({
    pubkey: key(pubkey),
    label: pubkey,
  }))
  const distances = vi.spyOn(graph, "getFollowDistance")
  const order = createLikeOrder(graph, key("viewer"))
  const names = (rows: typeof entries) => rows.map((row) => row.label)
  expect(names(order(entries))).toEqual([
    "viewer",
    "amber",
    "birch",
    "cedar",
    "ash",
    "away",
  ])
  const firstLookupCount = distances.mock.calls.length
  expect(firstLookupCount).toBe(entries.length - 1)
  expect(names(order(entries.toReversed()))).toEqual([
    "viewer",
    "amber",
    "birch",
    "cedar",
    "ash",
    "away",
  ])
  expect(distances).toHaveBeenCalledTimes(firstLookupCount)
  contacts("birch", ["cedar"], 2)
  expect(names(createLikeOrder(graph, key("viewer"))(entries))).toEqual([
    "viewer",
    "cedar",
    "amber",
    "birch",
    "ash",
    "away",
  ])
  const switched = createLikeOrder(graph, key("away"))
  expect(names(switched(entries))).toEqual([
    "away",
    "amber",
    "ash",
    "birch",
    "cedar",
    "viewer",
  ])
})
