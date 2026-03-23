import { afterEach, describe, expect, it, vi } from "vitest"
import { NDKSubscriptionCacheUsage } from "@/lib/ndk"

import { createRuntimeSubscribe } from "./runtimeSubscribe"

class FakeSubscription {
  private handler: ((event: {rawEvent: () => unknown}) => void) | null = null

  start = vi.fn()
  stop = vi.fn()

  on(_event: "event", handler: (event: {rawEvent: () => unknown}) => void): void {
    this.handler = handler
  }

  emit(rawEvent: unknown): void {
    this.handler?.({rawEvent: () => rawEvent})
  }
}

const ALICE = "A".repeat(64)
const BOB = "b".repeat(64)
const CAROL = "c".repeat(64)

const createNdk = () => {
  const calls: Array<{
    filter: Record<string, unknown>
    opts: Record<string, unknown>
    subscription: FakeSubscription
  }> = []

  return {
    calls,
    ndk: {
      pool: {
        connectedRelays: () => [{url: "wss://relay.one"}, {url: "wss://relay.two"}],
      },
      subscribe: vi.fn((filter: Record<string, unknown>, opts: Record<string, unknown>) => {
        const subscription = new FakeSubscription()
        calls.push({filter, opts, subscription})
        return subscription
      }),
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("createRuntimeSubscribe", () => {
  it("starts a relay-only backfill for newly added DM authors", () => {
    vi.spyOn(Date, "now").mockReturnValue(20_000)

    const {ndk, calls} = createNdk()
    const subscribe = createRuntimeSubscribe(ndk as never)
    const onEvent = vi.fn()

    const unsubscribe = subscribe(
      {
        kinds: [1060],
        authors: [ALICE],
      },
      onEvent
    )

    expect(calls).toHaveLength(2)
    expect(calls[0]?.filter).toEqual({
      kinds: [1060],
      authors: [ALICE],
    })
    expect(calls[1]?.filter).toEqual({
      kinds: [1060],
      authors: ["a".repeat(64)],
      since: 5,
      limit: 200,
    })
    expect(calls[1]?.opts).toMatchObject({
      closeOnEose: true,
      cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
      relayUrls: ["wss://relay.one", "wss://relay.two"],
    })

    calls[1]?.subscription.emit({id: "backfill-event"})
    expect(onEvent).toHaveBeenCalledWith({id: "backfill-event"})

    unsubscribe()
    expect(calls[0]?.subscription.stop).toHaveBeenCalledTimes(1)
    expect(calls[1]?.subscription.stop).toHaveBeenCalledTimes(1)
  })

  it("backfills only authors that were not already tracked", () => {
    const {ndk, calls} = createNdk()
    const subscribe = createRuntimeSubscribe(ndk as never)

    subscribe({kinds: [1060], authors: [ALICE, BOB]}, vi.fn())
    subscribe({kinds: [1060], authors: [BOB, CAROL]}, vi.fn())

    expect(calls).toHaveLength(4)
    expect(calls[1]?.filter).toEqual({
      kinds: [1060],
      authors: ["a".repeat(64), BOB],
      since: expect.any(Number),
      limit: 200,
    })
    expect(calls[3]?.filter).toEqual({
      kinds: [1060],
      authors: [CAROL],
      since: expect.any(Number),
      limit: 200,
    })
  })

  it("tracks author removal when a subscription is cleaned up", () => {
    const {ndk, calls} = createNdk()
    const subscribe = createRuntimeSubscribe(ndk as never)

    const unsubscribe = subscribe({kinds: [1060], authors: [ALICE]}, vi.fn())
    unsubscribe()
    subscribe({kinds: [1060], authors: [ALICE]}, vi.fn())

    expect(calls).toHaveLength(4)
    expect(calls[3]?.filter).toEqual({
      kinds: [1060],
      authors: ["a".repeat(64)],
      since: expect.any(Number),
      limit: 200,
    })
  })
})
