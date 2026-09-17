import {afterEach, expect, it, vi} from "vitest"
import NDK, {NDKEvent, NDKRelay, NDKSubscription} from "@/lib/ndk"
import {subscribeSearch} from "./subscribeSearch"

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it("waits for indexed results instead of ordinary relay completion", async () => {
  vi.useFakeTimers()
  const ndk = new NDK()
  // An ordinary relay without search support completes before the index.
  const ordinaryStart = vi
    .spyOn(NDKSubscription.prototype, "start")
    .mockImplementation(function (this: NDKSubscription) {
      this.emit("eose", this)
      return []
    })
  const relay = new NDKRelay("wss://search.example", undefined, ndk)
  const event = new NDKEvent(ndk, {
    id: "matching-note",
    pubkey: "a".repeat(64),
    kind: 1,
    created_at: 900,
    content: "marketplace for iris",
    tags: [],
  })
  ndk.transportPlugins.push({
    name: "worker-transport",
    onSubscribe(subscription) {
      const timer = setTimeout(() => {
        subscription.eventReceived(event, relay)
        subscription.eoseReceived(null)
      }, 50)
      subscription.once("close", () => clearTimeout(timer))
    },
  })
  const onEvent = vi.fn()
  const onProgress = vi.fn()
  const search = subscribeSearch(
    ndk,
    [{kinds: [1], search: "iris marketplace", until: 1000}],
    onEvent,
    () => false,
    onProgress
  )
  await vi.advanceTimersByTimeAsync(100)
  expect(ordinaryStart).not.toHaveBeenCalled()
  expect(onEvent).toHaveBeenCalledWith(event)
  expect(onProgress).toHaveBeenLastCalledWith({
    loading: false,
    canLoadMore: true,
    oldestSearched: 900,
  })
  search.stop()
})

it.each([false, true])(
  "retries an interrupted index page (partial: %s)",
  async (partial) => {
    vi.useFakeTimers()
    const ndk = new NDK()
    const relay = new NDKRelay("wss://search.example", undefined, ndk)
    const textRequests: number[] = []
    const onProgress = vi.fn()
    const onEvent = vi.fn()
    ndk.transportPlugins.push({
      name: "worker-transport",
      onSubscribe(subscription, filters) {
        const filter = filters[0]
        if (filter.search) textRequests.push(filter.until!)
        // The first text request loses its connection; the old tag index works.
        if (filter.search && textRequests.length === 1) {
          if (partial) {
            setTimeout(() => {
              subscription.eventReceived(
                new NDKEvent(ndk, {
                  id: "partial-match",
                  pubkey: "c".repeat(64),
                  kind: 1,
                  created_at: 950,
                  content: "iris",
                  tags: [],
                }),
                relay
              )
            }, 50)
          }
          return
        }
        const timer = setTimeout(() => {
          const event = new NDKEvent(ndk, {
            id: filter.search ? "recent-match" : "old-tag-match",
            pubkey: (filter.search ? "a" : "b").repeat(64),
            kind: 1,
            created_at: filter.search ? 900 : 100,
            content: "iris",
            tags: [["t", "iris"]],
          })
          subscription.eventReceived(event, relay)
          subscription.eoseReceived(null)
        }, 50)
        subscription.once("close", () => clearTimeout(timer))
      },
    })
    const search = subscribeSearch(
      ndk,
      [
        {kinds: [1], search: "iris", until: 1000},
        {kinds: [1], "#t": ["iris"], until: 1000},
      ],
      onEvent,
      () => !onEvent.mock.calls.some(([event]) => event.id === "recent-match"),
      onProgress
    )
    await vi.advanceTimersByTimeAsync(16_000)
    expect(textRequests).toEqual([1000, 1000])
    expect(
      onProgress.mock.calls.find(([state]) => state.oldestSearched !== undefined)?.[0]
        .oldestSearched
    ).toBe(1000)
    expect(onProgress.mock.calls.map(([state]) => state.oldestSearched)).not.toContain(0)
    expect(onEvent.mock.calls.some(([event]) => event.id === "recent-match")).toBe(true)
    expect(onProgress).toHaveBeenLastCalledWith({
      loading: false,
      canLoadMore: true,
      oldestSearched: 900,
    })
    search.stop()
  }
)
