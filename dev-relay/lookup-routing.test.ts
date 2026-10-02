// @vitest-environment node
import {afterEach, describe, expect, it} from "vitest"
import {finalizeEvent, generateSecretKey, nip19} from "nostr-tools"
import {FipsPubsubWireCodec} from "nostr-pubsub"
import {startNostrRelay} from "./nostr-relay"
import NostrClient from "../src/lib/nostr"

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})
const signed = (kind: number, content: string) =>
  finalizeEvent(
    {kind, content, tags: [], created_at: Math.floor(Date.now() / 1000)},
    generateSecretKey()
  )

async function relay(events: ReturnType<typeof signed>[] = []) {
  const server = await startNostrRelay({port: 0, initialEvents: events})
  cleanups.push(() => server.close())
  return server.url
}
function client(options: ConstructorParameters<typeof NostrClient>[0]) {
  const instance = new NostrClient(options)
  cleanups.push(() => instance.close())
  return instance
}

describe("public lookups across incomplete relay coverage", () => {
  it("uses metadata directories even when author routing is disabled, without sending posts there", async () => {
    const profile = signed(0, JSON.stringify({name: "Directory profile"}))
    const primary = await relay()
    const directory = await relay([profile])
    const instance = client({
      explicitRelayUrls: [primary],
      discoveryRelayUrls: [directory],
      enableOutboxModel: false,
    })
    const sub = instance.subscribe({kinds: [0], authors: [profile.pubkey]})
    const events: string[] = []
    sub.on("event", (event) => events.push(event.id))
    await expect.poll(() => events).toContain(profile.id)
    sub.stop()
    expect(instance.subscriptions.size).toBe(0)
    const post = instance.subscribe({kinds: [1], authors: [profile.pubkey]})
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(
      [...instance.subscriptions.values()].filter((s) =>
        s.opts.relayUrls?.includes(directory)
      )
    ).toHaveLength(0)
    post.stop()
    expect(
      (
        await instance.fetchEvent(
          {kinds: [0], authors: [profile.pubkey]},
          {cacheUsage: "network-only"}
        )
      )?.id
    ).toBe(profile.id)
  })

  it("uses a post's relay hint alongside the saved relays", async () => {
    const post = signed(1, "Only on the hinted relay")
    const instance = client({explicitRelayUrls: [await relay()], enableRelayHints: true})
    const hinted = await relay([post])
    const sub = instance.subscribe({ids: [post.id]}, {relayHints: [hinted]})
    const events: string[] = []
    sub.on("event", (event) => events.push(event.id))
    await expect.poll(() => events).toContain(post.id)
    sub.stop()
    expect(instance.subscriptions.size).toBe(0)
    const pointer = nip19.neventEncode({id: post.id, relays: [hinted]})
    expect((await instance.fetchEvent(pointer, {cacheUsage: "network-only"}))?.id).toBe(
      post.id
    )
  })

  it("ignores relay hints by default", async () => {
    const post = signed(1, "Only on the hinted relay")
    const instance = client({explicitRelayUrls: [await relay()]})
    const hinted = await relay([post])
    const sub = instance.subscribe({ids: [post.id]}, {relayHints: [hinted]})
    const events: string[] = []
    sub.on("event", (event) => events.push(event.id))
    await new Promise((resolve) => sub.once("eose", resolve))
    expect(events).toEqual([])
    expect([...instance.subscriptions.values()]).toEqual([sub])
    expect(instance.pool.relays.has(hinted)).toBe(false)
    sub.stop()
  })

  it("opens author routes when a relay list arrives after initial history", async () => {
    const secret = generateSecretKey()
    const post = finalizeEvent(
      {
        kind: 1,
        content: "Late-discovered author's post",
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      },
      secret
    )
    const hinted = await relay([post])
    const primary = await relay()
    const instance = client({explicitRelayUrls: [primary], enableOutboxModel: true})
    const sub = instance.subscribe({kinds: [1], authors: [post.pubkey]})
    const events: string[] = []
    sub.on("event", (event) => events.push(event.id))
    await new Promise((resolve) => sub.once("eose", resolve))
    expect(events).toEqual([])
    const list = finalizeEvent(
      {
        kind: 10002,
        content: "",
        tags: [["r", hinted, "write"]],
        created_at: Math.floor(Date.now() / 1000),
      },
      secret
    )
    await instance.getRuntime().publish(list, {requireAck: true})
    await expect.poll(() => events).toContain(post.id)
    sub.stop()
    expect(instance.subscriptions.size).toBe(0)
  })

  it("keeps explicitly scoped and cache-only requests out of discovery relays", async () => {
    const primary = await relay()
    const directory = await relay()
    const instance = client({
      explicitRelayUrls: [primary],
      discoveryRelayUrls: [directory],
      enableOutboxModel: true,
    })
    const filter = {kinds: [0], authors: ["a".repeat(64)]}
    const scoped = instance.subscribe(filter, {
      relayUrls: [primary],
      relayHints: [directory],
    })
    const cached = instance.subscribe(filter, {cacheUsage: "cache-only"})
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(instance.subscriptions.size).toBe(2)
    scoped.stop()
    cached.stop()
  })

  it("omits absent optional fields before sending post filters to peers", async () => {
    const instance = client({explicitRelayUrls: []})
    const sub = instance.subscribe({ids: ["a".repeat(64)], authors: undefined}, {}, false)
    expect(() =>
      new FipsPubsubWireCodec().encodeFrame({
        type: "req",
        subscriptionId: "post",
        filters: sub.filters,
      })
    ).not.toThrow()
    expect(sub.filters).toEqual([{ids: ["a".repeat(64)]}])
    sub.stop()
  })

  it("does not close a live interest on incomplete history", async () => {
    const instance = client({explicitRelayUrls: []})
    const sub = instance.subscribe({kinds: [0]}, {closeOnEose: true}, false)
    sub.eoseReceived(null, {complete: false, reason: "timeout", sources: []})
    expect(sub.closed).toBe(false)
    sub.eoseReceived(null, {
      complete: true,
      reason: "eose",
      sources: [{id: "relay", complete: true}],
    })
    expect(sub.closed).toBe(true)
  })
})
