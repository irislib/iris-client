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
