import {describe, expect, it} from "vitest"
import {SocialGraph} from "nostr-social-graph"
import {graphConsidersUserOvermuted} from "./visibility"

const key = (digit: string) => digit.repeat(64)

describe("graphConsidersUserOvermuted", () => {
  it("preserves root mute and nearest-distance opinion semantics", async () => {
    const root = key("0")
    const friend = key("1")
    const stranger = key("2")
    const target = key("3")
    const graph = new SocialGraph(root)

    graph.addFollower(root, friend)
    graph.addFollower(friend, target)
    graph.addFollower(root, stranger)
    await graph.recalculateFollowDistances()

    expect(graphConsidersUserOvermuted(graph, root)).toBe(false)
    expect(graphConsidersUserOvermuted(graph, target)).toBe(false)

    graph.handleEvent({
      id: key("4"),
      pubkey: root,
      created_at: 1,
      kind: 10000,
      tags: [["p", target]],
      content: "",
      sig: key("5") + key("5"),
    })
    expect(graphConsidersUserOvermuted(graph, target)).toBe(true)
  })
})
