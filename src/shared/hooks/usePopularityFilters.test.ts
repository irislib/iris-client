/** @vitest-environment jsdom */

import {act, createElement} from "react"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const graphMocks = vi.hoisted(() => {
  const state = {root: "viewer", follows: ["friend-a"]}
  const graph = {
    getRoot: vi.fn(() => state.root),
    getFollowedByUser: vi.fn(
      (pubkey: string, includeSelf = false) =>
        new Set(includeSelf ? [pubkey, ...state.follows] : state.follows)
    ),
  }
  return {
    state,
    graph,
    getSocialGraph: vi.fn(() => graph),
  }
})

const visibilityMocks = vi.hoisted(() => ({
  createAlgorithmicVisibilitySnapshot: vi.fn(() =>
    Object.freeze({
      shouldHideRecommendationUser: vi.fn(() => false),
      shouldHideAlgorithmicEvent: vi.fn(() => false),
    })
  ),
}))

vi.mock("@/utils/socialGraph", () => ({
  DEFAULT_SOCIAL_GRAPH_ROOT: "default-root",
  getSocialGraph: graphMocks.getSocialGraph,
}))

vi.mock("@/utils/visibility", () => ({
  createAlgorithmicVisibilitySnapshot:
    visibilityMocks.createAlgorithmicVisibilitySnapshot,
}))

import {useSocialGraphStore} from "@/stores/socialGraph"
import {useUserStore} from "@/stores/user"
import usePopularityFilters from "./usePopularityFilters"

;(
  globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}
).IS_REACT_ACT_ENVIRONMENT = true

type HookResult = ReturnType<typeof usePopularityFilters>

let latestResult: HookResult | undefined

function TestHook() {
  latestResult = usePopularityFilters()
  return null
}

describe("usePopularityFilters", () => {
  let container: HTMLDivElement
  let root: Root
  let originalPublicKey: string
  let originalGraphState: Pick<
    ReturnType<typeof useSocialGraphStore.getState>,
    "isReady" | "isRecrawling" | "version" | "muteListVersion"
  >

  beforeEach(() => {
    originalPublicKey = useUserStore.getState().publicKey
    const graphState = useSocialGraphStore.getState()
    originalGraphState = {
      isReady: graphState.isReady,
      isRecrawling: graphState.isRecrawling,
      version: graphState.version,
      muteListVersion: graphState.muteListVersion,
    }

    useUserStore.setState({publicKey: "viewer"})
    useSocialGraphStore.setState({
      isReady: false,
      isRecrawling: false,
      version: 10,
      muteListVersion: 20,
    })
    graphMocks.state.root = "viewer"
    graphMocks.state.follows = ["friend-a"]
    graphMocks.getSocialGraph.mockClear()
    graphMocks.graph.getRoot.mockClear()
    graphMocks.graph.getFollowedByUser.mockClear()
    visibilityMocks.createAlgorithmicVisibilitySnapshot.mockClear()
    latestResult = undefined
    container = document.createElement("div")
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    useUserStore.setState({publicKey: originalPublicKey})
    useSocialGraphStore.setState(originalGraphState)
  })

  it("freezes one ready graph snapshot until the hook remounts", async () => {
    await act(async () => root.render(createElement(TestHook, {key: "first-mount"})))

    expect(latestResult?.currentFilters.ready).toBe(false)
    expect(latestResult?.currentFilters.authors).toEqual([])
    expect(graphMocks.getSocialGraph).not.toHaveBeenCalled()

    await act(async () => {
      useSocialGraphStore.setState({isReady: true})
    })

    expect(latestResult?.currentFilters.ready).toBe(true)
    expect(latestResult?.currentFilters.authors).toEqual(["friend-a"])
    const capturedVisibility = latestResult?.visibilitySnapshot
    const capturedScope = latestResult?.currentFilters.scopeKey
    expect(capturedScope).toContain("graph=10/20")
    expect(visibilityMocks.createAlgorithmicVisibilitySnapshot).toHaveBeenCalledOnce()

    graphMocks.state.follows = ["friend-b"]
    await act(async () => {
      useSocialGraphStore.setState({version: 11, muteListVersion: 21})
      // Force an unrelated rerender to prove the memoized graph snapshot itself,
      // rather than the lack of a store notification, keeps the feed stable.
      root.render(createElement(TestHook, {key: "first-mount"}))
    })

    expect(latestResult?.currentFilters.authors).toEqual(["friend-a"])
    expect(latestResult?.visibilitySnapshot).toBe(capturedVisibility)
    expect(latestResult?.currentFilters.scopeKey).toBe(capturedScope)
    expect(graphMocks.getSocialGraph).toHaveBeenCalledOnce()
    expect(visibilityMocks.createAlgorithmicVisibilitySnapshot).toHaveBeenCalledOnce()

    await act(async () => root.render(createElement(TestHook, {key: "second-mount"})))

    expect(latestResult?.currentFilters.ready).toBe(true)
    expect(latestResult?.currentFilters.authors).toEqual(["friend-b"])
    expect(latestResult?.currentFilters.scopeKey).not.toBe(capturedScope)
    expect(latestResult?.currentFilters.scopeKey).toContain("graph=11/21")
    expect(latestResult?.visibilitySnapshot).not.toBe(capturedVisibility)
    expect(graphMocks.getSocialGraph).toHaveBeenCalledTimes(2)
    expect(visibilityMocks.createAlgorithmicVisibilitySnapshot).toHaveBeenCalledTimes(2)
  })

  it("uses the default graph root and its follows for an anonymous feed", async () => {
    graphMocks.state.root = "default-root"
    graphMocks.state.follows = ["default-friend"]
    useUserStore.setState({publicKey: ""})
    useSocialGraphStore.setState({isReady: true})

    await act(async () => root.render(createElement(TestHook)))

    expect(latestResult?.currentFilters.ready).toBe(true)
    expect(latestResult?.currentFilters.authors).toEqual(["default-friend"])
    expect(latestResult?.chronologicalAuthors).toEqual([])
    expect(latestResult?.currentFilters.scopeKey).toContain(
      "anonymous:default-root:graph=10/20"
    )
    expect(graphMocks.graph.getFollowedByUser).toHaveBeenCalledWith("default-root")
  })
})
