import {describe, expect, it, vi} from "vitest"
import {SocialGraph} from "nostr-social-graph"

const key = (n: number) => n.toString(16).padStart(64, "0")

function createGraph() {
  const graph = new SocialGraph(key(1))
  for (let n = 1; n < 20; n++) {
    graph.handleEvent({
      kind: 3,
      id: `contacts-${n}`,
      sig: "",
      content: "",
      pubkey: key(n),
      created_at: 1,
      tags: [["p", key(n + 1)]],
    })
  }
  return graph
}

describe("social graph distance recalculation", () => {
  it("keeps the complete graph visible while rebuilding distances", async () => {
    const graph = createGraph()
    const before = graph.size()
    const rebuilding = graph.recalculateFollowDistances(1, 1000, () => {})
    expect(graph.size()).toEqual(before)
    expect(graph.getFollowDistance(key(20))).toBe(19)
    await rebuilding
    expect(graph.size()).toEqual(before)
  })

  it("coalesces a burst of requests and includes changes made during a rebuild", async () => {
    const graph = createGraph()
    const logger = vi.fn()
    const rebuilding = graph.recalculateFollowDistances(1, 1000, logger)
    graph.handleEvent({
      kind: 3,
      id: "updated-contacts",
      sig: "",
      content: "",
      pubkey: key(1),
      created_at: 2,
      tags: [
        ["p", key(2)],
        ["p", key(30)],
      ],
    })
    await Promise.all([
      rebuilding,
      ...Array.from({length: 20}, () =>
        graph.recalculateFollowDistances(1, 1000, logger)
      ),
    ])
    expect(logger.mock.calls.filter(([line]) => line.includes(": start"))).toHaveLength(2)
    expect(graph.getFollowDistance(key(30))).toBe(1)
    expect(graph.getFollowDistance(key(20))).toBe(19)
  })
})
