/** @vitest-environment jsdom */

import {act, createElement} from "react"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const graphMocks = vi.hoisted(() => {
  const state = {root: "viewer"}
  const graph = {getRoot: vi.fn(() => state.root)}
  return {state, graph, getSocialGraph: vi.fn(() => graph)}
})

const visibilityMocks = vi.hoisted(() => ({
  getOrCreate: vi.fn(() => ({
    shouldHideRecommendationUser: vi.fn(() => false),
    shouldHideAlgorithmicEvent: vi.fn(() => false),
  })),
}))

vi.mock("@/utils/socialGraph", () => ({
  DEFAULT_SOCIAL_GRAPH_ROOT: "default-root",
  getSocialGraph: graphMocks.getSocialGraph,
}))

vi.mock("@/utils/visibility", () => ({
  getOrCreateAlgorithmicVisibilitySnapshot: visibilityMocks.getOrCreate,
}))

import {useSettingsStore} from "@/stores/settings"
import {useSocialGraphStore} from "@/stores/socialGraph"
import {useUserStore} from "@/stores/user"
import useRecommendationVisibilitySnapshot from "./useRecommendationVisibilitySnapshot"

;(
  globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}
).IS_REACT_ACT_ENVIRONMENT = true

let latestResult: ReturnType<typeof useRecommendationVisibilitySnapshot> | undefined

function TestHook({enabled = true}: {enabled?: boolean}) {
  latestResult = useRecommendationVisibilitySnapshot(enabled)
  return null
}

describe("useRecommendationVisibilitySnapshot", () => {
  let container: HTMLDivElement
  let root: Root
  let originalPublicKey: string
  let originalGraphState: Pick<
    ReturnType<typeof useSocialGraphStore.getState>,
    "isReady" | "isRecrawling" | "version" | "muteListVersion"
  >
  let originalMaxFollowDistance: number | undefined

  beforeEach(() => {
    originalPublicKey = useUserStore.getState().publicKey
    const graphState = useSocialGraphStore.getState()
    originalGraphState = {
      isReady: graphState.isReady,
      isRecrawling: graphState.isRecrawling,
      version: graphState.version,
      muteListVersion: graphState.muteListVersion,
    }
    originalMaxFollowDistance =
      useSettingsStore.getState().content.maxFollowDistanceForReplies

    useUserStore.setState({publicKey: "viewer"})
    useSocialGraphStore.setState({
      isReady: false,
      isRecrawling: false,
      version: 10,
      muteListVersion: 20,
    })
    useSettingsStore.setState((state) => ({
      content: {...state.content, maxFollowDistanceForReplies: 5},
    }))
    graphMocks.state.root = "viewer"
    graphMocks.getSocialGraph.mockClear()
    graphMocks.graph.getRoot.mockClear()
    visibilityMocks.getOrCreate.mockClear()
    latestResult = undefined
    container = document.createElement("div")
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    useUserStore.setState({publicKey: originalPublicKey})
    useSocialGraphStore.setState(originalGraphState)
    useSettingsStore.setState((state) => ({
      content: {
        ...state.content,
        maxFollowDistanceForReplies: originalMaxFollowDistance,
      },
    }))
  })

  it("waits for the current viewer graph before exposing a policy", async () => {
    await act(async () => root.render(createElement(TestHook)))
    expect(latestResult).toEqual({ready: false, snapshot: null})
    expect(visibilityMocks.getOrCreate).not.toHaveBeenCalled()

    graphMocks.state.root = "previous-viewer"
    await act(async () => {
      useSocialGraphStore.setState({isReady: true})
    })
    expect(latestResult).toEqual({ready: false, snapshot: null})
    expect(visibilityMocks.getOrCreate).not.toHaveBeenCalled()

    graphMocks.state.root = "viewer"
    await act(async () => {
      useSocialGraphStore.setState({version: 11})
    })
    expect(latestResult?.ready).toBe(true)
    expect(latestResult?.snapshot).not.toBeNull()
    expect(visibilityMocks.getOrCreate).toHaveBeenCalledOnce()
  })

  it("atomically refreshes mounted sidebar policy for graph and setting changes", async () => {
    useSocialGraphStore.setState({isReady: true})
    await act(async () => root.render(createElement(TestHook)))

    const initialSnapshot = latestResult?.snapshot
    expect(visibilityMocks.getOrCreate).toHaveBeenLastCalledWith(
      graphMocks.graph,
      5,
      10,
      20
    )

    await act(async () => {
      useSocialGraphStore.setState({muteListVersion: 21})
    })
    const mutedSnapshot = latestResult?.snapshot
    expect(mutedSnapshot).not.toBe(initialSnapshot)
    expect(visibilityMocks.getOrCreate).toHaveBeenCalledTimes(2)

    await act(async () => {
      useSettingsStore.setState((state) => ({
        content: {...state.content, maxFollowDistanceForReplies: 2},
      }))
    })
    expect(latestResult?.snapshot).not.toBe(mutedSnapshot)
    expect(visibilityMocks.getOrCreate).toHaveBeenLastCalledWith(
      graphMocks.graph,
      2,
      10,
      21
    )
  })

  it("does not build a policy for explicit people lists", async () => {
    useSocialGraphStore.setState({isReady: true})
    await act(async () => root.render(createElement(TestHook, {enabled: false})))

    expect(latestResult).toEqual({ready: false, snapshot: null})
    expect(visibilityMocks.getOrCreate).not.toHaveBeenCalled()
  })
})
