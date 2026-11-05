import {afterEach, expect, it, vi} from "vitest"
import type {NostrRuntimeOptions} from "nostr-pubsub"
import {createPrivateNostrRuntime} from "./privateRuntime"
import {attachLookupRoutes} from "./lookupRouting"

const fixtures = vi.hoisted(() => {
  const make = () => ({
    subscribe: vi.fn(() => ({close: vi.fn()})),
    publish: vi.fn(async () => ({
      accepted: true,
      remoteAccepted: true,
      queued: false,
      sources: [],
    })),
    setRelays: vi.fn(),
    addSource: vi.fn(),
    removeSource: vi.fn(),
    retryPending: vi.fn(async () => {}),
    getRelayStats: vi.fn(() => []),
    close: vi.fn(async () => {}),
  })
  return {
    make,
    receivers: [] as ReturnType<typeof make>[],
    discoveries: [] as ReturnType<typeof make>[],
    senders: [] as ReturnType<typeof make>[],
    receiverOptions: [] as NostrRuntimeOptions[],
  }
})

vi.mock("nostr-pubsub", async (original) => ({
  ...(await original<typeof import("nostr-pubsub")>()),
  createNostrRuntime: (options: NostrRuntimeOptions) => {
    const receiver = fixtures.make()
    fixtures.receivers.push({...receiver})
    fixtures.receiverOptions.push(options)
    return receiver
  },
  createAnonymousRelayDiscovery: () => {
    const discovery = fixtures.make()
    fixtures.discoveries.push(discovery)
    return discovery
  },
  createPrivateRelayPublisher: () => {
    const sender = fixtures.make()
    fixtures.senders.push(sender)
    return sender
  },
}))

afterEach(() => {
  fixtures.receivers.length =
    fixtures.discoveries.length =
    fixtures.senders.length =
    fixtures.receiverOptions.length =
      0
})

const oldRelay = "wss://old.test/"
const ditto = "wss://relay.ditto.pub/"
const key = "a".repeat(64)
const event = (kind: number) => ({
  id: "b".repeat(64),
  sig: "c".repeat(128),
  pubkey: key,
  created_at: 1,
  kind,
  content: "synthetic",
  tags: [
    ["v", "2"],
    ["p", key],
  ],
})

it("does not add public profile directories or outbox routes to private lookups", () => {
  const client = {
    explicitRelayUrls: [oldRelay],
    discoveryRelayUrls: [ditto],
    enableOutboxModel: true,
    enableRelayHints: true,
    subscribe: vi.fn(() => ({on: vi.fn(), stop: vi.fn()})),
  }
  const parent = {
    opts: {privateRelayScope: true},
    filters: [{kinds: [0], authors: [key]}],
    waitForHistory: vi.fn(),
    once: vi.fn(),
  }
  attachLookupRoutes(client as never, parent as never)
  expect(client.subscribe).not.toHaveBeenCalled()
  attachLookupRoutes(client as never, {...parent, opts: {}} as never)
  expect(client.subscribe).toHaveBeenCalled()
})

it("routes mixed public/private reads and private identity discovery to their own scopes", async () => {
  const runtime = createPrivateNostrRuntime({
    relays: [oldRelay, ditto],
    privateRelayUrls: [oldRelay],
  })
  expect(fixtures.receiverOptions.map((options) => options.relays)).toEqual([
    [oldRelay, ditto],
    [oldRelay],
  ])
  const onEvent = vi.fn()
  runtime.subscribe([{kinds: [1, 1060]}], {onEvent})
  expect(fixtures.receivers[0].subscribe).toHaveBeenCalledWith(
    [{kinds: [1]}],
    expect.anything(),
    {}
  )
  expect(fixtures.receivers[1].subscribe).toHaveBeenCalledWith(
    [{kinds: [1060]}],
    expect.anything(),
    {relays: undefined}
  )
  runtime.subscribe([{kinds: [37368], authors: [key]}], {onEvent})
  expect(fixtures.discoveries[1].subscribe).toHaveBeenCalled()
  runtime.subscribe([{kinds: [0], authors: [key]}], {onEvent})
  expect(fixtures.discoveries[0].subscribe).toHaveBeenCalled()
  runtime.subscribePrivate([{ids: [event(1060).id]}], {onEvent})
  expect(fixtures.receivers[1].subscribe).toHaveBeenLastCalledWith(
    [{ids: [event(1060).id]}],
    {onEvent},
    {relays: undefined}
  )
  await runtime.close()
})

it("caps private publication and authorization facts even when connected relay overrides include Ditto", async () => {
  const runtime = createPrivateNostrRuntime({
    relays: [oldRelay, ditto],
    privateRelayUrls: [oldRelay],
  })
  await runtime.publish(event(1))
  expect(fixtures.receivers[0].publish).toHaveBeenCalledWith(event(1), undefined)
  await runtime.publish(event(1060), {relays: [oldRelay, ditto], requireAck: true})
  expect(fixtures.senders[0].publish).toHaveBeenCalledWith(event(1060), {
    relays: [oldRelay],
    requireAck: true,
  })
  await runtime.publishPrivate(event(37368))
  expect(fixtures.receivers[0].publish).toHaveBeenLastCalledWith(event(37368), {
    relays: [oldRelay],
  })
  runtime.setRelays([ditto])
  expect(fixtures.receivers[1].setRelays).not.toHaveBeenCalled()
  runtime.setPrivateRelays([])
  expect(fixtures.receivers[1].setRelays).toHaveBeenLastCalledWith([])
  expect(fixtures.senders[0].setRelays).toHaveBeenLastCalledWith([])
  await runtime.publishPrivate(event(37368), {relays: [oldRelay, ditto]})
  expect(fixtures.receivers[0].publish).toHaveBeenLastCalledWith(event(37368), {
    relays: [],
  })
  await runtime.close()
})

it("keeps shared-scope callers compatible until a private scope is explicitly supplied", async () => {
  const runtime = createPrivateNostrRuntime({relays: [oldRelay]})
  runtime.setRelays([ditto])
  expect(fixtures.receivers[1].setRelays).toHaveBeenLastCalledWith([ditto])
  expect(fixtures.senders[0].setRelays).toHaveBeenLastCalledWith([ditto])
  await runtime.close()
})
