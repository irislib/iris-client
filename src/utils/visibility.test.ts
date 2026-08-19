import {describe, expect, it} from "vitest"
import {SocialGraph} from "nostr-social-graph"
import {
  SOCIAL_GRAPH_OVERMUTE_THRESHOLD,
  clearVisibilityCache,
  createAlgorithmicVisibilitySnapshot,
  getOrCreateAlgorithmicVisibilitySnapshot,
  graphConsidersUnsolicitedEventHidden,
  graphConsidersUnsolicitedUserHidden,
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
    expect(
      graphConsidersUserOvermuted(graph, target, SOCIAL_GRAPH_OVERMUTE_THRESHOLD)
    ).toBe(true)
    expect(graphConsidersUnsolicitedUserHidden(graph, target, undefined)).toBe(true)
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

    // Unsolicited surfaces reject unreachable senders even when the user's
    // general reply-distance setting is unlimited.
    expect(graphConsidersUnsolicitedUserHidden(graph, root, undefined)).toBe(false)
    expect(graphConsidersUnsolicitedUserHidden(graph, known, undefined)).toBe(false)
    expect(graphConsidersUnsolicitedUserHidden(graph, unknown, undefined)).toBe(true)
  })

  it("lets a direct follow through unless the root directly mutes it", async () => {
    const root = key("0")
    const target = key("1")
    const muter = key("2")
    const graph = new SocialGraph(root)

    graph.addFollower(root, target)
    graph.addFollower(root, muter)
    graph.handleEvent({
      id: key("3"),
      pubkey: muter,
      created_at: 1,
      kind: 10000,
      tags: [["p", target]],
      content: "",
      sig: key("4") + key("4"),
    })
    await graph.recalculateFollowDistances()

    expect(graphConsidersUnsolicitedUserHidden(graph, target, undefined)).toBe(false)

    graph.handleEvent({
      id: key("5"),
      pubkey: root,
      created_at: 2,
      kind: 10000,
      tags: [["p", target]],
      content: "",
      sig: key("6") + key("6"),
    })

    expect(graphConsidersUnsolicitedUserHidden(graph, target, undefined)).toBe(true)
  })

  it("checks an attributed sender instead of a wrapper event signer", async () => {
    const root = key("0")
    const followedSender = key("1")
    const unknownSender = key("2")
    const bridge = key("3")
    const nonExplicitSender = key("4")
    const muter = key("5")
    const overmutedMention = key("6")
    const graph = new SocialGraph(root)

    graph.addFollower(root, followedSender)
    graph.addFollower(root, bridge)
    graph.addFollower(root, muter)
    graph.addFollower(bridge, nonExplicitSender)
    graph.handleEvent({
      id: key("7"),
      pubkey: muter,
      created_at: 1,
      kind: 10000,
      tags: [["p", overmutedMention]],
      content: "",
      sig: key("8") + key("8"),
    })
    await graph.recalculateFollowDistances()

    const serviceSignedEvent = {pubkey: root, tags: [["p", overmutedMention]]}
    expect(
      graphConsidersUnsolicitedEventHidden(
        graph,
        serviceSignedEvent,
        followedSender,
        undefined
      )
    ).toBe(false)
    expect(
      graphConsidersUnsolicitedEventHidden(
        graph,
        serviceSignedEvent,
        unknownSender,
        undefined
      )
    ).toBe(true)
    expect(
      graphConsidersUnsolicitedEventHidden(
        graph,
        serviceSignedEvent,
        nonExplicitSender,
        undefined
      )
    ).toBe(true)
  })
})

describe("createAlgorithmicVisibilitySnapshot", () => {
  it("shares one expensive build per graph policy revision", async () => {
    const root = key("0")
    const known = key("1")
    const graph = new SocialGraph(root)

    graph.addFollower(root, known)
    await graph.recalculateFollowDistances()
    clearVisibilityCache()

    const first = getOrCreateAlgorithmicVisibilitySnapshot(graph, 5, 10, 20)
    const shared = getOrCreateAlgorithmicVisibilitySnapshot(graph, 5, 10, 20)
    const nextMuteRevision = getOrCreateAlgorithmicVisibilitySnapshot(graph, 5, 10, 21)
    const nextDistance = getOrCreateAlgorithmicVisibilitySnapshot(graph, 2, 10, 21)

    expect(shared).toBe(first)
    expect(nextMuteRevision).not.toBe(first)
    expect(nextDistance).not.toBe(nextMuteRevision)
  })

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
    expect(snapshot.shouldHideRecommendationUser(root)).toBe(false)
    expect(snapshot.shouldHideRecommendationUser(explicitAuthor)).toBe(false)
    expect(snapshot.shouldHideAlgorithmicEvent({pubkey: explicitAuthor, tags: []})).toBe(
      false
    )
    expect(snapshot.shouldHideAlgorithmicEvent({pubkey: root, tags: []})).toBe(false)

    // A root mute always wins, even over an explicit follow.
    expect(snapshot.shouldHideRecommendationUser(directlyMuted)).toBe(true)
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
