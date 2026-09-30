// @vitest-environment node
import {expect, it, vi} from "vitest"
import {FipsNode, identityFromSecretKey, toHex, type PeerEvent} from "@fips/core"
import {WebSocketTransport} from "@fips/transport-websocket"
import {WebSocket} from "ws"
import {startLocalFipsWebSocketSeed} from "../tests/fixtures/localFipsWebSocketSeed"

it("routes an authenticated record larger than the MTU through the browser test seed", async () => {
  const seed = await startLocalFipsWebSocketSeed()
  const nodes: FipsNode[] = []
  try {
    for (const scalar of [1, 2]) {
      const secret = new Uint8Array(32)
      secret[31] = scalar
      nodes.push(
        new FipsNode({
          identity: await identityFromSecretKey(secret),
          transports: [
            new WebSocketTransport({
              seedUrls: [seed.url],
              webSocket: WebSocket as unknown as typeof globalThis.WebSocket,
            }),
          ],
          routingMode: "reply_learned",
        })
      )
    }
    const connected = new Set<FipsNode>()
    for (const node of nodes)
      node.on("peer", (event) => {
        if ((event as PeerEvent).state === "connected") connected.add(node)
      })
    const received: Uint8Array[] = []
    nodes[1].registerService(4242, ({payload}) => {
      received.push(payload)
    })
    await Promise.all(nodes.map((node) => node.start()))
    await vi.waitFor(() => expect(connected.size).toBe(2), {timeout: 5000})
    const dst = toHex(nodes[1].identity.publicKey)
    await expect(
      nodes[0].sendDatagram({dst, dstPort: 4242, payload: new Uint8Array([1])})
    ).resolves.toBeUndefined()
    await vi.waitFor(() => expect(received).toHaveLength(1))

    // An authenticated application record may exceed the path's packet MTU.
    // Reliable WebSocket records still carry it intact through the seed.
    const payload = new TextEncoder().encode("peer-record ".repeat(400))
    await expect(
      nodes[0].sendDatagram({dst, dstPort: 4242, payload})
    ).resolves.toBeUndefined()
    await vi.waitFor(() => expect(received[1]).toEqual(payload))
  } finally {
    await Promise.all(nodes.map((node) => node.stop()))
    await seed.close()
  }
}, 15000)
