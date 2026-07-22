import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => {
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
    emit(event: unknown) {
      eventHandler?.(event)
    },
    reset() {
      eventHandler = undefined
      subscribe.mockClear()
      stop.mockClear()
    },
  }
})

vi.mock("./ndk", () => ({
  ndk: () => ({subscribe: mocks.subscribe}),
}))

vi.mock("./eventCache", () => ({
  cacheEvent: vi.fn(),
  getEvent: vi.fn(async () => null),
  getEventSync: vi.fn(() => null),
}))

import {fetchEventsReliable} from "./fetchEventsReliable"

describe("fetchEventsReliable", () => {
  beforeEach(() => {
    mocks.reset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("settles an incomplete ID batch after the received events go idle", async () => {
    const result = fetchEventsReliable(
      {ids: ["one", "two", "missing"]},
      {timeout: 1000, settleAfterMs: 300}
    )
    let settled = false
    void result.promise.then(() => {
      settled = true
    })

    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve()
    }
    expect(mocks.subscribe).toHaveBeenCalledOnce()
    mocks.emit({id: "one"})
    mocks.emit({id: "two"})

    await vi.advanceTimersByTimeAsync(299)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
    await expect(result.promise).resolves.toHaveLength(2)
    expect(mocks.stop).toHaveBeenCalledOnce()
  })
})
