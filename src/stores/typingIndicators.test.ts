import {beforeEach, afterEach, describe, expect, it, vi} from "vitest"
import {createTypingThrottle, TYPING_EXPIRY_MS, useTypingStore} from "./typingIndicators"

describe("typingIndicators store", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useTypingStore.getState().clearAll()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("sets typing state for a chat", () => {
    useTypingStore.getState().setRemoteTyping("chat-1")
    expect(useTypingStore.getState().isTyping.get("chat-1")).toBe(true)
  })

  it("expires typing state after timeout", () => {
    useTypingStore.getState().setRemoteTyping("chat-1")
    vi.advanceTimersByTime(TYPING_EXPIRY_MS + 1)
    expect(useTypingStore.getState().isTyping.get("chat-1")).toBeUndefined()
  })

  it("clears typing state when a message arrives", () => {
    useTypingStore.getState().setRemoteTyping("chat-1")
    useTypingStore.getState().clearRemoteTyping("chat-1", Date.now())
    expect(useTypingStore.getState().isTyping.get("chat-1")).toBeUndefined()
  })

  it("ignores stale typing events", () => {
    const now = Date.now()
    useTypingStore.getState().clearRemoteTyping("chat-1", now)
    useTypingStore.getState().setRemoteTyping("chat-1", now - 1000)
    expect(useTypingStore.getState().isTyping.get("chat-1")).toBeUndefined()
  })
})

describe("createTypingThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("fires immediately and throttles subsequent calls", () => {
    const fn = vi.fn()
    const throttled = createTypingThrottle(fn, 3000)

    throttled.fire()
    expect(fn).toHaveBeenCalledTimes(1)

    throttled.fire()
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(3000)
    throttled.fire()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("reset allows immediate fire", () => {
    const fn = vi.fn()
    const throttled = createTypingThrottle(fn, 3000)

    throttled.fire()
    throttled.reset()
    throttled.fire()
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
