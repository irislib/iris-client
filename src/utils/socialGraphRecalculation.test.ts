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
  it("keeps a root switch queued as the previous recalculation completes", async () => {
    const graph = createGraph()
    let switched: Promise<void> | undefined
    await graph.recalculateFollowDistances(1000, 1000, (message) => {
      if (message.includes(": done")) {
        queueMicrotask(() => {
          switched = graph.setRoot(key(2))
        })
      }
    })
    await switched
    expect(graph.getRoot()).toBe(key(2))
    expect(graph.getFollowDistance(key(2))).toBe(0)
    expect(graph.getFollowDistance(key(20))).toBe(18)
  })

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
    await Promise.resolve()
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

describe("discovery bootstrap merges into the retained personal graph", () => {
  const head = (kind: number, at: number, id: number, targets: number[]) => ({
    kind,
    created_at: at,
    id: key(id),
    pubkey: key(1),
    sig: "",
    content: "",
    tags: targets.map((target) => ["p", key(target)]),
  })
  it("accepts a newer complete bootstrap list while preserving unrelated local crawl data", async () => {
    const retained = new SocialGraph(key(1)),
      bootstrap = new SocialGraph(key(1))
    retained.handleEvent(head(3, 10, 10, [2]), true)
    retained.handleEvent({...head(3, 10, 11, [4]), pubkey: key(3)}, true)
    bootstrap.handleEvent(head(3, 20, 20, [5]), true)
    await retained.merge(bootstrap)
    expect([...retained.getFollowedByUser(key(1))]).toEqual([key(5)])
    expect([...retained.getFollowedByUser(key(3))]).toEqual([key(4)])
  })
  it("restores a partial equal-revision list from a complete bootstrap", async () => {
    for (const kind of [3, 10000]) {
      const retained = new SocialGraph(key(1)),
        bootstrap = new SocialGraph(key(1))
      retained.handleEvent(head(kind, 10, 10, [2]), true)
      retained.markListIncomplete(key(1), kind)
      bootstrap.handleEvent(head(kind, 10, 10, [2, 3]), true)
      await retained.merge(bootstrap)
      expect(retained.getListRevision(key(1), kind)?.complete).toBe(true)
      expect(
        kind === 3
          ? retained.getFollowedByUser(key(1)).size
          : retained.getMutedByUser(key(1)).size
      ).toBe(2)
    }
  })
  it("never replaces a locally crawled full list with a newer truncated bootstrap", async () => {
    const retained = new SocialGraph(key(1)),
      bootstrap = new SocialGraph(key(1))
    retained.handleEvent(head(3, 10, 10, [2, 3]), true)
    bootstrap.handleEvent(head(3, 20, 20, [5]), true)
    bootstrap.markListIncomplete(key(1), 3)
    await retained.merge(bootstrap)
    expect([...retained.getFollowedByUser(key(1))]).toEqual([key(2), key(3)])
    expect(retained.getListRevision(key(1), 3)?.id).toBe(key(10))
  })
})
