/** @vitest-environment jsdom */

import {act, createElement} from "react"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {SocialGraph} from "nostr-social-graph"
import {
  createAlgorithmicVisibilitySnapshot,
  type AlgorithmicVisibilitySnapshot,
} from "@/utils/visibility"

const ndkMocks = vi.hoisted(() => {
  let eventHandler: ((event: unknown) => void) | undefined
  const stop = vi.fn()
  const subscribe = vi.fn(() => ({
    on: vi.fn((type: string, handler: (event: unknown) => void) => {
      if (type === "event") eventHandler = handler
    }),
    stop,
  }))

  return {
    subscribe,
    stop,
    emitEvent(event: unknown) {
      eventHandler?.(event)
    },
    reset() {
      eventHandler = undefined
      subscribe.mockClear()
      stop.mockClear()
    },
  }
})

vi.mock("@/utils/ndk", () => ({
  ndk: () => ({subscribe: ndkMocks.subscribe}),
}))

import useReactionSubscription from "./useReactionSubscription"

;(
  globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}
).IS_REACT_ACT_ENVIRONMENT = true

const FILTERS = {
  since: 1,
  limit: 1000,
  authors: ["author"],
  ready: true,
  scopeKey: "viewer-a",
}
const CACHE: Parameters<typeof useReactionSubscription>[2] = {}
const expandFilters = vi.fn()
const defaultVisibilitySnapshot: AlgorithmicVisibilitySnapshot = {
  shouldHideRecommendationUser: vi.fn(() => false),
  shouldHideAlgorithmicEvent: vi.fn(() => false),
}
let latestHasInitialData = false
let latestGetNextMostPopular: (count: number) => string[] = () => []

function TestHook({
  filterSeen = false,
  filters = FILTERS,
  visibilitySnapshot = defaultVisibilitySnapshot,
}: {
  filterSeen?: boolean
  filters?: Parameters<typeof useReactionSubscription>[0]
  visibilitySnapshot?: AlgorithmicVisibilitySnapshot
}) {
  const result = useReactionSubscription(
    filters,
    expandFilters,
    CACHE,
    visibilitySnapshot,
    filterSeen
  )
  latestHasInitialData = result.hasInitialData
  latestGetNextMostPopular = result.getNextMostPopular
  return null
}

describe("useReactionSubscription", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ndkMocks.reset()
    vi.mocked(defaultVisibilitySnapshot.shouldHideRecommendationUser).mockReset()
    vi.mocked(defaultVisibilitySnapshot.shouldHideRecommendationUser).mockReturnValue(
      false
    )
    vi.mocked(defaultVisibilitySnapshot.shouldHideAlgorithmicEvent).mockReset()
    vi.mocked(defaultVisibilitySnapshot.shouldHideAlgorithmicEvent).mockReturnValue(false)
    delete CACHE.authorScope
    delete CACHE.hasInitialData
    delete CACHE.pendingReactionCounts
    delete CACHE.showingReactionCounts
    expandFilters.mockClear()
    latestHasInitialData = false
    latestGetNextMostPopular = () => []
    container = document.createElement("div")
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
  })

  it("uses one reaction subscription instead of opening a post subscription per event", async () => {
    await act(async () => root.render(createElement(TestHook)))

    await act(async () => {
      for (let index = 0; index < 25; index += 1) {
        ndkMocks.emitEvent({
          id: `reaction-${index}`,
          pubkey: `actor-${index}`,
          kind: 7,
          created_at: index + 1,
          tags: [["e", `post-${index}`]],
        })
      }
    })

    expect(ndkMocks.subscribe).toHaveBeenCalledOnce()
  })

  it("waits for scoped graph authors instead of opening a global subscription", async () => {
    await act(async () =>
      root.render(
        createElement(TestHook, {
          filters: {
            since: 1,
            limit: 1000,
            authors: [],
            ready: false,
            scopeKey: "viewer-a",
          },
        })
      )
    )

    expect(ndkMocks.subscribe).not.toHaveBeenCalled()

    await act(async () => root.render(createElement(TestHook)))

    expect(ndkMocks.subscribe).toHaveBeenCalledOnce()
    expect(ndkMocks.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({authors: ["author"], kinds: [7, 6]})
    )
  })

  it("drops candidates collected under a previous recommender scope", async () => {
    await act(async () => root.render(createElement(TestHook)))
    await act(async () => {
      ndkMocks.emitEvent({
        id: "old-reaction",
        pubkey: "author",
        kind: 7,
        created_at: 2,
        tags: [["e", "old-post"]],
      })
    })

    expect(latestGetNextMostPopular(10)).toEqual(["old-post"])

    await act(async () =>
      root.render(
        createElement(TestHook, {
          filters: {
            since: 1,
            limit: 1000,
            authors: ["new-author"],
            ready: true,
            scopeKey: "viewer-a-new-scope",
          },
        })
      )
    )

    expect(latestGetNextMostPopular(10)).toEqual([])
  })

  it("visibility-checks reaction and repost actors and deduplicates by actor", async () => {
    vi.mocked(defaultVisibilitySnapshot.shouldHideRecommendationUser).mockImplementation(
      (pubkey: string) => pubkey === "unknown-actor"
    )
    await act(async () => root.render(createElement(TestHook)))

    await act(async () => {
      ndkMocks.emitEvent({
        id: "hidden-reaction",
        pubkey: "unknown-actor",
        kind: 7,
        created_at: 2,
        tags: [["e", "reaction-post"]],
      })
      ndkMocks.emitEvent({
        id: "hidden-repost",
        pubkey: "unknown-actor",
        kind: 6,
        created_at: 3,
        tags: [["e", "repost-post"]],
      })
      ndkMocks.emitEvent({
        id: "visible-reaction",
        pubkey: "visible-actor",
        kind: 7,
        created_at: 4,
        tags: [["e", "reaction-post"]],
      })
      ndkMocks.emitEvent({
        id: "visible-repost",
        pubkey: "visible-actor",
        kind: 6,
        created_at: 5,
        tags: [["e", "repost-post"]],
      })
    })

    expect(defaultVisibilitySnapshot.shouldHideRecommendationUser).toHaveBeenCalledWith(
      "unknown-actor"
    )
    expect(CACHE.pendingReactionCounts?.get("reaction-post")).toEqual(
      new Set(["visible-actor"])
    )
    expect(CACHE.pendingReactionCounts?.get("repost-post")).toEqual(
      new Set(["visible-actor"])
    )
  })

  it("rejects an in-filter unknown actor using the real graph policy", async () => {
    const rootPubKey = "0".repeat(64)
    const visibleActor = "1".repeat(64)
    const unknownActor = "2".repeat(64)
    const graph = new SocialGraph(rootPubKey)
    graph.addFollower(rootPubKey, visibleActor)
    await graph.recalculateFollowDistances()
    const visibilitySnapshot = createAlgorithmicVisibilitySnapshot(graph, undefined)

    await act(async () =>
      root.render(
        createElement(TestHook, {
          filters: {
            since: 1,
            limit: 1000,
            authors: [unknownActor, visibleActor],
            ready: true,
            scopeKey: "real-policy-scope",
          },
          visibilitySnapshot,
        })
      )
    )

    expect(ndkMocks.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({authors: [unknownActor, visibleActor]})
    )

    await act(async () => {
      ndkMocks.emitEvent({
        id: "unknown-reaction",
        pubkey: unknownActor,
        kind: 7,
        created_at: 2,
        tags: [["e", "unknown-recommended-post"]],
      })
      ndkMocks.emitEvent({
        id: "visible-reaction",
        pubkey: visibleActor,
        kind: 7,
        created_at: 3,
        tags: [["e", "visible-recommended-post"]],
      })
    })

    expect(CACHE.pendingReactionCounts?.has("unknown-recommended-post")).toBe(false)
    expect(CACHE.pendingReactionCounts?.get("visible-recommended-post")).toEqual(
      new Set([visibleActor])
    )
  })

  it("does not declare Popular empty after its first cold-start window", async () => {
    vi.useFakeTimers()
    await act(async () => root.render(createElement(TestHook)))

    await act(async () => vi.advanceTimersByTime(5000))

    expect(latestHasInitialData).toBe(false)
    expect(expandFilters).toHaveBeenCalled()
  })
})
