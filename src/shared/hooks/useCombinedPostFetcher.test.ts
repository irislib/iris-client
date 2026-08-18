/** @vitest-environment jsdom */

import {act, createElement} from "react"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import type {NDKEvent} from "@/lib/ndk"
import type {AlgorithmicVisibilitySnapshot} from "@/utils/visibility"

type VisibilityEvent = Parameters<
  AlgorithmicVisibilitySnapshot["shouldHideAlgorithmicEvent"]
>[0]

const mocks = vi.hoisted(() => ({
  publicKey: "viewer" as string | null,
  addSeenEventId: vi.fn(),
  fetchEventsReliable: vi.fn(),
  shouldHideAlgorithmicEvent: vi.fn<(event: VisibilityEvent) => boolean>(() => false),
}))

vi.mock("@/stores/user", () => ({
  useUserStore: (selector: (state: {publicKey: string | null}) => unknown) =>
    selector({publicKey: mocks.publicKey}),
}))

vi.mock("@/utils/memcache", () => ({
  addSeenEventId: mocks.addSeenEventId,
}))

vi.mock("@/utils/fetchEventsReliable", () => ({
  fetchEventsReliable: mocks.fetchEventsReliable,
}))

import useCombinedPostFetcher from "./useCombinedPostFetcher"

;(
  globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}
).IS_REACT_ACT_ENVIRONMENT = true

type HookProps = Parameters<typeof useCombinedPostFetcher>[0]
type HookResult = ReturnType<typeof useCombinedPostFetcher>

const event = (id: string, pubkey = "author") =>
  ({id, pubkey, tags: []}) as unknown as NDKEvent

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return {promise, resolve}
}

let latestResult: HookResult | undefined

function TestHook(props: HookProps) {
  latestResult = useCombinedPostFetcher(props)
  return null
}

const baseProps = (overrides: Partial<HookProps> = {}): HookProps => ({
  getNextPopular: vi.fn(() => []),
  getNextChronological: vi.fn(() => []),
  hasPopularData: false,
  hasChronologicalData: false,
  cache: {},
  sourceKey: "scope-a",
  ready: true,
  visibilitySnapshot: {
    shouldHideRecommendationUser: vi.fn(() => false),
    shouldHideAlgorithmicEvent: mocks.shouldHideAlgorithmicEvent,
  },
  ...overrides,
})

describe("useCombinedPostFetcher", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.publicKey = "viewer"
    mocks.addSeenEventId.mockReset()
    mocks.fetchEventsReliable.mockReset()
    mocks.shouldHideAlgorithmicEvent.mockReset()
    mocks.shouldHideAlgorithmicEvent.mockReturnValue(false)
    latestResult = undefined
    container = document.createElement("div")
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
  })

  it("renders no cached events and starts no fetch while the graph is not ready", async () => {
    const cachedEvent = event("cached")
    const cache: HookProps["cache"] = {
      scopeKey: "viewer:scope-a",
      events: [cachedEvent],
      hasLoadedInitial: true,
    }

    await act(async () => {
      root.render(
        createElement(TestHook, {
          ...baseProps({
            cache,
            ready: false,
            hasPopularData: true,
            getNextPopular: vi.fn(() => [cachedEvent.id]),
          }),
        })
      )
    })

    expect(latestResult?.events).toEqual([])
    expect(latestResult?.loading).toBe(true)
    expect(mocks.fetchEventsReliable).not.toHaveBeenCalled()
  })

  it("renders a matching cache only after readiness and drops it on a scope change", async () => {
    const cachedEvent = event("cached-for-a")
    const cache: HookProps["cache"] = {
      scopeKey: "viewer:scope-a",
      events: [cachedEvent],
      hasLoadedInitial: true,
    }
    const props = baseProps({cache, ready: false})

    await act(async () => root.render(createElement(TestHook, props)))
    expect(latestResult?.events).toEqual([])

    await act(async () => root.render(createElement(TestHook, {...props, ready: true})))
    expect(latestResult?.events.map(({id}) => id)).toEqual([cachedEvent.id])

    await act(async () =>
      root.render(createElement(TestHook, {...props, ready: true, sourceKey: "scope-b"}))
    )
    expect(latestResult?.events).toEqual([])
    expect(cache.scopeKey).toBe("viewer:scope-b")
    expect(cache.events).toEqual([])
    expect(mocks.fetchEventsReliable).not.toHaveBeenCalled()
  })

  it("does not commit an in-flight fetch after its source scope changes", async () => {
    const oldEvent = event("old-scope-event")
    const pendingFetch = deferred<NDKEvent[]>()
    const unsubscribe = vi.fn()
    mocks.fetchEventsReliable.mockReturnValue({
      promise: pendingFetch.promise,
      unsubscribe,
    })

    const cache: HookProps["cache"] = {}
    const getNextPopular = vi
      .fn<() => string[]>()
      .mockReturnValueOnce([oldEvent.id])
      .mockReturnValue([])
    const props = baseProps({
      cache,
      getNextPopular,
      hasPopularData: true,
      sourceKey: "scope-a",
    })

    await act(async () => root.render(createElement(TestHook, props)))
    expect(mocks.fetchEventsReliable).toHaveBeenCalledOnce()

    await act(async () =>
      root.render(
        createElement(TestHook, {
          ...props,
          sourceKey: "scope-b",
          hasPopularData: false,
        })
      )
    )

    await act(async () => {
      pendingFetch.resolve([oldEvent])
      await pendingFetch.promise
      await Promise.resolve()
    })

    expect(latestResult?.events).toEqual([])
    expect(mocks.addSeenEventId).not.toHaveBeenCalled()
    expect(cache.scopeKey).toBe("viewer:scope-b")
    expect(cache.events).toEqual([])
  })

  it("uses the captured visibility policy for initial and later batches", async () => {
    const initialEvent = event("initial")
    const visibleLaterEvent = event("visible-later")
    const hiddenLaterEvent = event("hidden-later")
    const getNextPopular = vi
      .fn<() => string[]>()
      .mockReturnValueOnce([initialEvent.id])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([visibleLaterEvent.id, hiddenLaterEvent.id])
      .mockReturnValueOnce([])

    mocks.shouldHideAlgorithmicEvent.mockImplementation(
      (candidate) => candidate === hiddenLaterEvent
    )
    const eventsById = new Map([
      [initialEvent.id, initialEvent],
      [visibleLaterEvent.id, visibleLaterEvent],
      [hiddenLaterEvent.id, hiddenLaterEvent],
    ])
    mocks.fetchEventsReliable.mockImplementation((filter: {ids?: string[]}) => ({
      promise: Promise.resolve((filter.ids || []).map((id) => eventsById.get(id)!)),
      unsubscribe: vi.fn(),
    }))

    await act(async () => {
      root.render(
        createElement(
          TestHook,
          baseProps({
            getNextPopular,
            hasPopularData: true,
            popularRatio: 1,
          })
        )
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(latestResult?.events.map(({id}) => id)).toEqual([initialEvent.id])

    await act(async () => {
      await latestResult?.loadMore()
    })

    expect(latestResult?.events.map(({id}) => id)).toEqual([
      initialEvent.id,
      visibleLaterEvent.id,
    ])
    expect(mocks.shouldHideAlgorithmicEvent).toHaveBeenCalledWith(initialEvent)
    expect(mocks.shouldHideAlgorithmicEvent).toHaveBeenCalledWith(hiddenLaterEvent)
  })
})
