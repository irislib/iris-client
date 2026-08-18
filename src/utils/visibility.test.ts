import {describe, expect, it} from "vitest"
import {SocialGraph} from "nostr-social-graph"
import {
  createAlgorithmicVisibilitySnapshot,
  graphConsidersUserOvermuted,
  graphConsidersUserUnknown,
} from "./visibility"

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

  it("treats one nearby mute against one nearby follow as overmuted at feed threshold", async () => {
    const root = key("0")
    const follower = key("1")
    const muter = key("2")
    const target = key("3")
    const graph = new SocialGraph(root)

    graph.addFollower(root, follower)
    graph.addFollower(root, muter)
    graph.addFollower(follower, target)
    graph.handleEvent({
      id: key("4"),
      pubkey: muter,
      created_at: 1,
      kind: 10000,
      tags: [["p", target]],
      content: "",
      sig: key("5") + key("5"),
    })
    await graph.recalculateFollowDistances()

    expect(graphConsidersUserOvermuted(graph, target)).toBe(false)
    expect(graphConsidersUserOvermuted(graph, target, 3)).toBe(true)
  })

  it("treats accounts outside the loaded graph as unknown", async () => {
    const root = key("0")
    const known = key("1")
    const unknown = key("2")
    const graph = new SocialGraph(root)

    graph.addFollower(root, known)
    await graph.recalculateFollowDistances()

    expect(graphConsidersUserUnknown(graph, root)).toBe(false)
    expect(graphConsidersUserUnknown(graph, known)).toBe(false)
    expect(graphConsidersUserUnknown(graph, unknown)).toBe(true)
  })
})

describe("createAlgorithmicVisibilitySnapshot", () => {
  it("keeps actor and post visibility immutable after the live graph changes", async () => {
    const root = key("0")
    const recommender = key("1")
    const muter = key("2")
    const visibleAuthor = key("3")
    const initiallyUnknown = key("4")
    const graph = new SocialGraph(root)

    graph.addFollower(root, recommender)
    graph.addFollower(root, muter)
    graph.addFollower(recommender, visibleAuthor)
    await graph.recalculateFollowDistances()

    const snapshot = createAlgorithmicVisibilitySnapshot(graph, undefined)

    expect(snapshot.shouldHideRecommendationUser(visibleAuthor)).toBe(false)
    expect(snapshot.shouldHideRecommendationUser(initiallyUnknown)).toBe(true)
    expect(snapshot.shouldHideAlgorithmicEvent({pubkey: visibleAuthor, tags: []})).toBe(
      false
    )

    graph.handleEvent({
      id: key("5"),
      pubkey: muter,
      created_at: 1,
      kind: 10000,
      tags: [["p", visibleAuthor]],
      content: "",
      sig: key("6") + key("6"),
    })
    graph.addFollower(recommender, initiallyUnknown)
    await graph.recalculateFollowDistances()

    // A mounted feed keeps using the graph policy captured before these updates.
    expect(snapshot.shouldHideRecommendationUser(visibleAuthor)).toBe(false)
    expect(snapshot.shouldHideRecommendationUser(initiallyUnknown)).toBe(true)
    expect(snapshot.shouldHideAlgorithmicEvent({pubkey: visibleAuthor, tags: []})).toBe(
      false
    )

    const refreshedSnapshot = createAlgorithmicVisibilitySnapshot(graph, undefined)
    expect(refreshedSnapshot.shouldHideRecommendationUser(visibleAuthor)).toBe(true)
    expect(refreshedSnapshot.shouldHideRecommendationUser(initiallyUnknown)).toBe(false)
    expect(
      refreshedSnapshot.shouldHideAlgorithmicEvent({pubkey: visibleAuthor, tags: []})
    ).toBe(true)
  })

  it("preserves explicit-author precedence and snapshots unreachable overmuted mentions", async () => {
    const root = key("0")
    const explicitAuthor = key("1")
    const directlyMuted = key("2")
    const muter = key("3")
    const visibleAuthor = key("4")
    const unreachableMention = key("5")
    const graph = new SocialGraph(root)

    graph.addFollower(root, explicitAuthor)
    graph.addFollower(root, directlyMuted)
    graph.addFollower(root, muter)
    graph.addFollower(muter, visibleAuthor)
    await graph.recalculateFollowDistances()

    graph.handleEvent({
      id: key("6"),
      pubkey: muter,
      created_at: 1,
      kind: 10000,
      tags: [
        ["p", explicitAuthor],
        ["p", unreachableMention],
      ],
      content: "",
      sig: key("7") + key("7"),
    })
    graph.handleEvent({
      id: key("8"),
      pubkey: root,
      created_at: 1,
      kind: 10000,
      tags: [["p", directlyMuted]],
      content: "",
      sig: key("9") + key("9"),
    })

    const snapshot = createAlgorithmicVisibilitySnapshot(graph, undefined)

    // Explicit follows and self remain visible unless the root directly mutes them.
    expect(snapshot.shouldHideRecommendationUser(explicitAuthor)).toBe(false)
    expect(snapshot.shouldHideAlgorithmicEvent({pubkey: explicitAuthor, tags: []})).toBe(
      false
    )
    expect(snapshot.shouldHideAlgorithmicEvent({pubkey: root, tags: []})).toBe(false)

    // A root mute always wins, even over an explicit follow.
    expect(snapshot.shouldHideAlgorithmicEvent({pubkey: directlyMuted, tags: []})).toBe(
      true
    )

    expect(graph.getFollowDistance(unreachableMention)).toBe(1000)
    expect(
      snapshot.shouldHideAlgorithmicEvent({
        pubkey: visibleAuthor,
        tags: [["p", unreachableMention]],
      })
    ).toBe(true)
  })
})
