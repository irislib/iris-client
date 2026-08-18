/** @vitest-environment jsdom */

import {act, createElement} from "react"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const ndkMocks = vi.hoisted(() => {
  const subscriptions: Array<{
    emitEvent: (event: unknown) => void
    stop: ReturnType<typeof vi.fn>
  }> = []

  const subscribe = vi.fn(() => {
    let eventHandler: ((event: unknown) => void) | undefined
    const subscription = {
      emitEvent(event: unknown) {
        eventHandler?.(event)
      },
      on: vi.fn((type: string, handler: (event: unknown) => void) => {
        if (type === "event") eventHandler = handler
      }),
      stop: vi.fn(),
    }
    subscriptions.push(subscription)
    return subscription
  })

  return {
    subscribe,
    subscriptions,
    reset() {
      subscribe.mockClear()
      subscriptions.splice(0)
    },
  }
})

vi.mock("@/utils/ndk", () => ({
  ndk: () => ({subscribe: ndkMocks.subscribe}),
}))

vi.mock("@/stores/user", () => ({
  useUserStore: (selector: (state: {publicKey: string}) => unknown) =>
    selector({publicKey: "viewer"}),
}))

vi.mock("@/utils/memcache", () => ({
  seenEventIds: new Set<string>(),
}))

vi.mock("@/utils/nostr", () => ({
  getEventReplyingTo: () => undefined,
}))

import useChronologicalSubscription from "./useChronologicalSubscription"

;(
  globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}
).IS_REACT_ACT_ENVIRONMENT = true

type Cache = Parameters<typeof useChronologicalSubscription>[0]
type HookResult = ReturnType<typeof useChronologicalSubscription>

const AUTHORS_A = ["author-a"]
const AUTHORS_B = ["author-b"]
let latestResult: HookResult | undefined

function TestHook({
  cache,
  ready,
  authors,
  graphScope,
}: {
  cache: Cache
  ready: boolean
  authors: string[]
  graphScope: string
}) {
  latestResult = useChronologicalSubscription(
    cache,
    false,
    false,
    false,
    ready,
    authors,
    graphScope
  )
  return null
}

const event = (id: string, pubkey: string, createdAt: number) => ({
  id,
  pubkey,
  created_at: createdAt,
  tags: [],
})

describe("useChronologicalSubscription", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ndkMocks.reset()
    latestResult = undefined
    container = document.createElement("div")
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
  })

  it("does not subscribe before the social graph is ready", async () => {
    const cache: Cache = {}

    await act(async () =>
      root.render(
        createElement(TestHook, {
          cache,
          ready: false,
          authors: AUTHORS_A,
          graphScope: "scope-a",
        })
      )
    )

    expect(ndkMocks.subscribe).not.toHaveBeenCalled()
    expect(latestResult?.hasInitialData).toBe(false)

    await act(async () =>
      root.render(
        createElement(TestHook, {
          cache,
          ready: true,
          authors: AUTHORS_A,
          graphScope: "scope-a",
        })
      )
    )

    expect(ndkMocks.subscribe).toHaveBeenCalledOnce()
    expect(ndkMocks.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({authors: AUTHORS_A})
    )
  })

  it("drops pending post IDs when the author scope changes", async () => {
    const cache: Cache = {}

    await act(async () =>
      root.render(
        createElement(TestHook, {
          cache,
          ready: true,
          authors: AUTHORS_A,
          graphScope: "scope-a",
        })
      )
    )
    await act(async () => {
      ndkMocks.subscriptions[0].emitEvent(event("old-post", "author-a", 2))
    })
    expect(cache.pendingPosts?.has("old-post")).toBe(true)

    await act(async () =>
      root.render(
        createElement(TestHook, {
          cache,
          ready: true,
          authors: AUTHORS_B,
          graphScope: "scope-b",
        })
      )
    )

    let nextPosts: string[] = []
    await act(async () => {
      nextPosts = latestResult?.getNextChronological(10) ?? []
    })
    expect(nextPosts).toEqual([])
    expect(cache.pendingPosts?.has("old-post")).toBe(false)
  })

  it("ignores an old-scope event queued before its subscription stopped", async () => {
    const cache: Cache = {}

    await act(async () =>
      root.render(
        createElement(TestHook, {
          cache,
          ready: true,
          authors: AUTHORS_A,
          graphScope: "scope-a",
        })
      )
    )
    const oldSubscription = ndkMocks.subscriptions[0]

    await act(async () =>
      root.render(
        createElement(TestHook, {
          cache,
          ready: true,
          authors: AUTHORS_B,
          graphScope: "scope-b",
        })
      )
    )
    const currentSubscription = ndkMocks.subscriptions[1]
    expect(oldSubscription.stop).toHaveBeenCalledOnce()

    await act(async () => {
      oldSubscription.emitEvent(event("queued-old-post", "author-a", 3))
      currentSubscription.emitEvent(event("current-post", "author-b", 4))
    })

    expect(cache.pendingPosts?.has("queued-old-post")).toBe(false)
    expect(cache.pendingPosts?.has("current-post")).toBe(true)
  })
})
