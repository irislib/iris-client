import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {EventEmitter} from "tseep"
import {attachLookupRoutes, ID_FALLBACK_DELAY_MS} from "./lookupRouting"

const saved = "wss://saved.example"
const fallback = "wss://fallback.example"
const idA = "a".repeat(64)
const idB = "b".repeat(64)

function setup(options: Record<string, unknown> = {}) {
  const client = {
    explicitRelayUrls: [saved],
    discoveryRelayUrls: [],
    fallbackRelayUrls: [saved, fallback],
    enableOutboxModel: true,
    enableRelayHints: false,
    subscribe: vi.fn(() => ({on: vi.fn(), stop: vi.fn()})),
    ...options,
  }
  const parent = Object.assign(new EventEmitter(), {
    opts: {},
    filters: [{ids: [idA, idB]}],
    closed: false,
    waitForHistory: vi.fn(),
    eventReceived: vi.fn(),
  })
  attachLookupRoutes(client as never, parent as never)
  return {client, parent}
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it("asks fallback relays only for ids the saved relays did not deliver in time", () => {
  const {client, parent} = setup()
  parent.emit("event", {id: idA})
  expect(client.subscribe).not.toHaveBeenCalled()
  vi.advanceTimersByTime(ID_FALLBACK_DELAY_MS)
  expect(client.subscribe).toHaveBeenCalledWith(
    [{ids: [idB]}],
    expect.objectContaining({relayUrls: [fallback]})
  )
})

it("leaves fallback relays alone when the lookup resolved, closed or may not leave the saved list", () => {
  const resolved = setup()
  resolved.parent.emit("event", {id: idA})
  resolved.parent.emit("event", {id: idB})
  const closed = setup()
  closed.parent.emit("close")
  const restricted = setup({enableOutboxModel: false})
  vi.advanceTimersByTime(ID_FALLBACK_DELAY_MS)
  for (const {client} of [resolved, closed, restricted])
    expect(client.subscribe).not.toHaveBeenCalled()
})
