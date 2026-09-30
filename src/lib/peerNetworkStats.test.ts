import {describe, expect, it, vi} from "vitest"
import type {Transport, TransportContext} from "@fips/core"
import {BrowserNetworkStats} from "../../node_modules/@hashtree/fips-transport/dist/browserStats.js"

async function transportFixture(stats: BrowserNetworkStats, type = "webrtc") {
  let context!: TransportContext
  const send = vi.fn(async () => {})
  const transport: Transport = {
    type,
    mtu: 1400,
    start: async (value) => {
      context = value
    },
    stop: async () => {},
    connect: async () => {},
    send,
  }
  const observed = stats.observe(transport)
  const onPacket = vi.fn()
  const onConnectionState = vi.fn()
  await observed.start({onPacket, onConnectionState} as unknown as TransportContext)
  const address = {transport: type, addr: "address"}
  return {context, observed, send, address, onPacket, onConnectionState}
}

describe("peer transport telemetry", () => {
  it("measures actual packet bytes, preserves delivery, and excludes failed sends", async () => {
    const stats = new BrowserNetworkStats()
    const {context, observed, send, address, onPacket} = await transportFixture(stats)
    stats.peer({remoteAddr: address, remotePubkey: "peer", state: "connected"})
    const packet = {
      transportType: "webrtc",
      remoteAddr: address,
      data: new Uint8Array(120),
      receivedAtMs: 1,
    }
    context.onPacket(packet)
    expect(onPacket).toHaveBeenCalledWith(packet)
    await observed.send(address, new Uint8Array(64))
    send.mockRejectedValueOnce(new Error("closed"))
    await expect(observed.send(address, new Uint8Array(200))).rejects.toThrow("closed")
    const snapshot = stats.snapshot()
    expect(snapshot.transports.webrtc).toEqual({bytesSent: 64, bytesReceived: 120})
    expect(snapshot.peers[0]).toMatchObject({
      peerId: "peer",
      bytesSent: 64,
      bytesReceived: 120,
    })
    snapshot.transports.webrtc.bytesSent = 1000
    snapshot.peers[0].peerId = "changed"
    expect(stats.snapshot().peers[0].peerId).toBe("peer")
    expect(stats.snapshot().transports.webrtc.bytesSent).toBe(64)
  })

  it("keeps seed and WebRTC paths distinct and removes stale peers without losing session totals", async () => {
    const stats = new BrowserNetworkStats()
    const rtc = await transportFixture(stats)
    const ws = await transportFixture(stats, "websocket")
    for (const {address} of [rtc, ws]) {
      stats.peer({remoteAddr: address, remotePubkey: "same-peer", state: "connected"})
    }
    await rtc.observed.send(rtc.address, new Uint8Array(50))
    await ws.observed.send(ws.address, new Uint8Array(70))
    const event = {remoteAddr: rtc.address, state: "disconnected" as const}
    rtc.context.onConnectionState?.(event)
    expect(rtc.onConnectionState).toHaveBeenCalledWith(event)
    expect(stats.snapshot().peers.map((peer) => peer.transport)).toEqual(["websocket"])
    expect(stats.snapshot().transports.webrtc.bytesSent).toBe(50)
    stats.peer({remoteAddr: rtc.address, remotePubkey: "same-peer", state: "connected"})
    expect(
      stats.snapshot().peers.find((peer) => peer.transport === "webrtc")?.bytesSent
    ).toBe(0)
    stats.clearPeers()
    expect(stats.snapshot().peers).toEqual([])
    expect(stats.snapshot().transports.websocket.bytesSent).toBe(70)
  })

  it("does not present unauthenticated transport traffic as a connected peer", async () => {
    const stats = new BrowserNetworkStats()
    const {context, address} = await transportFixture(stats)
    context.onConnectionState?.({remoteAddr: address, state: "connected"})
    context.onPacket({
      transportType: "webrtc",
      remoteAddr: address,
      data: new Uint8Array(20),
      receivedAtMs: 1,
    })
    expect(stats.snapshot().peers).toEqual([])
    expect(stats.snapshot().transports.webrtc.bytesReceived).toBe(20)
  })
})
