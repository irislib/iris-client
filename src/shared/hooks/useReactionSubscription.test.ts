/** @vitest-environment jsdom */

import {act, createElement} from "react"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const ndkMocks = vi.hoisted(() => {
  let eventHandler: ((event: unknown) => void) | undefined
  const stop = vi.fn()
  const subscribe = vi.fn(() => ({
    on: vi.fn((type: string, handler: (event: unknown) => void) => {
      if (type === "event" && !eventHandler) eventHandler = handler
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

const FILTERS = {since: 1, limit: 1000, authors: ["author"]}
const CACHE: Parameters<typeof useReactionSubscription>[2] = {}
const expandFilters = vi.fn()
let latestHasInitialData = false

function TestHook({filterSeen = false}: {filterSeen?: boolean}) {
  latestHasInitialData = useReactionSubscription(
    FILTERS,
    expandFilters,
    CACHE,
    filterSeen
  ).hasInitialData
  return null
}

describe("useReactionSubscription", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ndkMocks.reset()
    delete CACHE.hasInitialData
    delete CACHE.pendingReactionCounts
    delete CACHE.showingReactionCounts
    expandFilters.mockClear()
    latestHasInitialData = false
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
          kind: 7,
          created_at: index + 1,
          tags: [["e", `post-${index}`]],
        })
      }
    })

    expect(ndkMocks.subscribe).toHaveBeenCalledOnce()
  })

  it("does not declare Popular empty after its first cold-start window", async () => {
    vi.useFakeTimers()
    await act(async () => root.render(createElement(TestHook)))

    await act(async () => vi.advanceTimersByTime(5000))

    expect(latestHasInitialData).toBe(false)
    expect(expandFilters).toHaveBeenCalled()
  })
})
