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
import {getEvent, getEventSync} from "./eventCache"
import type {NDKEvent} from "@/lib/ndk"

describe("fetchEventsReliable", () => {
  beforeEach(() => {
    mocks.reset()
    vi.mocked(getEvent).mockReset().mockResolvedValue(null)
    vi.mocked(getEventSync).mockReset().mockReturnValue(null)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(["memory", "disk"])(
    "displays a partial %s cache hit without waiting for the missing post timeout",
    async (source) => {
      const cached = {id: "cached"} as NDKEvent
      if (source === "memory") {
        vi.mocked(getEventSync).mockImplementation((id) =>
          id === cached.id ? cached : null
        )
      } else {
        vi.mocked(getEvent).mockImplementation(async (id) =>
          id === cached.id ? cached : null
        )
      }

      const result = fetchEventsReliable(
        {ids: [cached.id, "missing"]},
        {timeout: 4000, settleAfterMs: 300}
      )
      let received: NDKEvent[] | undefined
      void result.promise.then((events) => (received = events))

      await vi.advanceTimersByTimeAsync(300)
      expect(received).toEqual([cached])
      expect(mocks.stop).toHaveBeenCalledOnce()
    }
  )

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
