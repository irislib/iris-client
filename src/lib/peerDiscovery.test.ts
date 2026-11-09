// @vitest-environment node
import {expect, it} from "vitest"
import {generateIdentity} from "@fips/core"
import {NostrPeerDiscovery, NostrRelayClient} from "@fips/transport-webrtc"
import {finalizeEvent, generateSecretKey, type Filter} from "nostr-tools"
import WebSocket from "ws"
import {startNostrRelay} from "../../dev-relay/nostr-relay"

it("bounds direct discovery by its TTL without widening author lookups or closing live delivery", async () => {
  const now = Math.floor(Date.now() / 1000)
  const secret = generateSecretKey()
  const advert = (key: Uint8Array, created_at: number) =>
    finalizeEvent(
      {
        kind: 37195,
        created_at,
        tags: [
          ["d", "iris-client"],
          ["protocol", "iris-client"],
          ["expiration", String(created_at + 30)],
        ],
        content: JSON.stringify({
          identifier: "fips-overlay-v1",
          version: 1,
          endpoints: [],
          stunServers: [],
        }),
      },
      key
    )
  const recent = advert(secret, now - 2)
  const other = advert(generateSecretKey(), now - 1)
  const filters: Filter[] = []
  const server = await startNostrRelay({
    port: 0,
    initialEvents: [recent, other],
    onRequest: (request) => filters.push(...request),
  })
  const relay = new NostrRelayClient({
    url: server.url,
    webSocket: WebSocket as unknown as typeof globalThis.WebSocket,
  })
  const discovery = new NostrPeerDiscovery({
    identity: await generateIdentity(),
    relays: [relay],
    discoveryApp: "iris-client",
    advertTtlMs: 30_000,
  })
  const received: string[] = []
  try {
    await discovery.subscribeAdverts((event) => received.push(event.id), {
      authors: [recent.pubkey],
    })
    await expect.poll(() => received).toEqual([recent.id])
    expect(filters).toHaveLength(1)
    expect(filters[0]).toMatchObject({
      authors: [recent.pubkey],
      kinds: [37195],
      "#d": ["iris-client"],
      limit: 64,
    })
    expect(filters[0].since).toBeGreaterThanOrEqual(now - 30)
    expect(filters[0].since).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) - 30)
    const live = advert(secret, now)
    await relay.publish(live)
    await expect.poll(() => received).toEqual([recent.id, live.id])
  } finally {
    discovery.stop()
    relay.close()
    await server.close()
  }
})
