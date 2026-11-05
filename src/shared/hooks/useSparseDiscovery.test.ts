// @vitest-environment jsdom
import {act, createElement} from "react"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent, generateSecretKey, getPublicKey} from "nostr-tools"
import type {AppEvent} from "@/lib/nostr"
const mocks = vi.hoisted(() => ({subscribe: vi.fn()}))
vi.mock("@/utils/nostrClient", () => ({nostr: () => ({subscribe: mocks.subscribe})}))
import useSparseDiscovery from "./useSparseDiscovery"
type Props = {args: Parameters<typeof useSparseDiscovery>}
let result: ReturnType<typeof useSparseDiscovery>
function Hook({args}: Props) {
  result = useSparseDiscovery(...args)
  return null
}
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe("bounded discovery subscription", () => {
  let root: Root
  let callbacks: Map<string, (...args: any[]) => void>
  let stop: ReturnType<typeof vi.fn>
  const secret = generateSecretKey(),
    author = getPublicKey(secret)
  const signed = (content: string) => {
    const event = finalizeEvent(
      {kind: 1, tags: [], content, created_at: Math.floor(Date.now() / 1000) - 1},
      secret
    )
    return {...event, rawEvent: () => event} as unknown as AppEvent
  }
  beforeEach(() => {
    vi.useFakeTimers()
    callbacks = new Map()
    stop = vi.fn()
    mocks.subscribe
      .mockReset()
      .mockImplementation(() => ({
        on: (name: string, fn: (...args: any[]) => void) => callbacks.set(name, fn),
        stop,
      }))
    root = createRoot(document.createElement("div"))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
  })

  it("never makes an empty-author or disabled match-all request", async () => {
    await act(async () => root.render(createElement(Hook, {args: [{}, [], "a", true]})))
    await act(async () =>
      root.render(createElement(Hook, {args: [{}, [author], "a", false]}))
    )
    expect(mocks.subscribe).not.toHaveBeenCalled()
  })

  it("closes the whole read at eight seconds and ignores queued late records", async () => {
    const cache = {},
      authors = [author],
      early = signed("early"),
      late = signed("late")
    await act(async () =>
      root.render(createElement(Hook, {args: [cache, authors, "a", true]}))
    )
    const receive = callbacks.get("event")!
    await act(async () => {
      receive(early)
      await vi.advanceTimersByTimeAsync(8000)
    })
    expect(result.ready).toBe(true)
    expect(result.events.map((e) => e.id)).toEqual([early.id])
    expect(stop).toHaveBeenCalledOnce()
    await act(async () => receive(late))
    expect(result.events.map((e) => e.id)).toEqual([early.id])
    expect(mocks.subscribe.mock.calls[0][0]).toEqual([
      expect.objectContaining({authors: [author], kinds: [1], limit: 8}),
    ])
  })

  it("invalidates old-account callbacks and reuses completed scoped cache without resubscribing", async () => {
    const cache = {},
      authors = [author],
      old = signed("old"),
      fresh = signed("fresh")
    await act(async () =>
      root.render(createElement(Hook, {args: [cache, authors, "old", true]}))
    )
    const oldReceive = callbacks.get("event")!,
      oldFinish = callbacks.get("eose")!
    await act(async () =>
      root.render(createElement(Hook, {args: [cache, authors, "new", true]}))
    )
    await act(async () => {
      oldReceive(old)
      oldFinish()
      callbacks.get("event")!(fresh)
      callbacks.get("eose")!()
    })
    expect(result.events.map((e) => e.id)).toEqual([fresh.id])
    await act(async () => root.unmount())
    root = createRoot(document.createElement("div"))
    await act(async () =>
      root.render(createElement(Hook, {args: [cache, authors, "new", true]}))
    )
    expect(mocks.subscribe).toHaveBeenCalledTimes(2)
    expect(result.ready).toBe(true)
    expect(result.events.map((e) => e.id)).toEqual([fresh.id])
  })
})
