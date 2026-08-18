import {describe, expect, it, vi} from "vitest"
import {NDKEvent} from "../events/index.js"
import {NDK} from "../ndk/index.js"
import {
  NDKSubscription,
  NDKSubscriptionCacheUsage,
} from "./index.js"

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return {promise, resolve}
}

describe("waitForCacheBeforeRelays", () => {
  it("does not open relays until an asynchronous cache query finishes", async () => {
    const cacheResult = deferred<[]>()
    const ndk = new NDK({explicitRelayUrls: []})
    ndk.cacheAdapter = {
      locking: false,
      query: vi.fn(() => cacheResult.promise),
    }

    const subscription = new NDKSubscription(
      ndk,
      {kinds: [3]},
      {
        cacheUsage: NDKSubscriptionCacheUsage.PARALLEL,
        waitForCacheBeforeRelays: true,
      }
    )
    const startWithRelays = vi
      .spyOn(
        subscription as unknown as {startWithRelays: () => void},
        "startWithRelays"
      )
      .mockImplementation(() => undefined)

    subscription.start()
    expect(startWithRelays).not.toHaveBeenCalled()

    cacheResult.resolve([])
    await cacheResult.promise
    await Promise.resolve()

    expect(startWithRelays).toHaveBeenCalledOnce()
  })

  it("continues to relays after a synchronous full cache hit", () => {
    const ndk = new NDK({explicitRelayUrls: []})
    const eventId = "d".repeat(64)
    ndk.cacheAdapter = {
      locking: true,
      query: vi.fn(() => [
        new NDKEvent(ndk, {
          id: eventId,
          pubkey: "a".repeat(64),
          created_at: 1,
          kind: 1,
          tags: [],
          content: "",
          sig: "signature",
        }),
      ]),
    }
    const subscription = new NDKSubscription(
      ndk,
      {ids: [eventId]},
      {waitForCacheBeforeRelays: true}
    )
    const startWithRelays = vi
      .spyOn(
        subscription as unknown as {startWithRelays: () => void},
        "startWithRelays"
      )
      .mockImplementation(() => undefined)

    subscription.start()

    expect(startWithRelays).toHaveBeenCalledOnce()
  })
})
