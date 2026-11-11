import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {EventEmitter} from "tseep"
import {attachLookupRoutes, AUTHOR_ROUTE_DELAY_MS} from "./lookupRouting"

const author = "a".repeat(64)

function setup() {
  const lists = Object.assign(new EventEmitter(), {stop: vi.fn(), completion: undefined})
  const client = {
    explicitRelayUrls: ["wss://saved.example"],
    discoveryRelayUrls: [],
    fallbackRelayUrls: [],
    enableOutboxModel: true,
    enableRelayHints: false,
    subscribe: vi.fn(() => lists),
  }
  const waiting: Array<{once: (event: "eose", done: () => void) => void}> = []
  const parent = Object.assign(new EventEmitter(), {
    opts: {},
    filters: [{kinds: [7], authors: [author]}],
    closed: false,
    waitForHistory: vi.fn((sub) => waiting.push(sub)),
    eventReceived: vi.fn(),
  })
  attachLookupRoutes(client as never, parent as never)
  return {client, parent, lists, waiting}
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it("looks up author relay lists after the caller's own request, and holds its history until they answer", () => {
  const {client, lists, waiting} = setup()
  const done = vi.fn()
  waiting[0].once("eose", done)
  expect(client.subscribe).not.toHaveBeenCalled()
  vi.advanceTimersByTime(AUTHOR_ROUTE_DELAY_MS)
  expect(client.subscribe).toHaveBeenCalledWith({kinds: [10002], authors: [author]})
  expect(done).not.toHaveBeenCalled()
  lists.emit("eose")
  expect(done).toHaveBeenCalledTimes(1)
})

it("skips the lookup when the caller closed first", () => {
  const {client, parent} = setup()
  parent.emit("close")
  vi.advanceTimersByTime(AUTHOR_ROUTE_DELAY_MS)
  expect(client.subscribe).not.toHaveBeenCalled()
})
