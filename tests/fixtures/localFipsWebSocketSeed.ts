import type {AddressInfo} from "node:net"

import {
  FipsNode,
  generateIdentity,
  type Transport,
  type TransportAddress,
  type TransportContext,
} from "@fips/core"
import {
  decodeLocalKeyHint,
  encodeLocalKeyHintResponse,
  validateFipsWebSocketRecord,
} from "@fips/transport-websocket"
import {WebSocketServer, type WebSocket} from "ws"

const MAX_FRAME_BYTES = 66 * 1024
const MAX_CONNECTIONS = 64

export interface LocalFipsWebSocketSeed {
  url: string
  close(): Promise<void>
}

class InboundWebSocketTransport implements Transport {
  readonly type = "websocket"
  readonly mtu = 1_400
  readonly maxFrameBytes = MAX_FRAME_BYTES

  private context?: TransportContext
  private server?: WebSocketServer
  private readonly sockets = new Map<string, WebSocket>()
  private nextConnection = 0
  private boundUrl?: string

  get url(): string {
    if (!this.boundUrl) {
      throw new Error("WebSocket seed has not started")
    }
    return this.boundUrl
  }

  async start(context: TransportContext): Promise<void> {
    this.context = context
    const server = new WebSocketServer({
      host: "127.0.0.1",
      port: 0,
      path: "/fips",
      maxPayload: MAX_FRAME_BYTES,
      perMessageDeflate: false,
    })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve)
      server.once("error", reject)
    })
    const {port} = server.address() as AddressInfo
    this.boundUrl = `ws://127.0.0.1:${port}/fips`
    server.on("connection", (socket) => this.accept(socket))
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.boundUrl = undefined
    for (const socket of this.sockets.values()) {
      socket.terminate()
    }
    this.sockets.clear()
    this.context = undefined
    if (!server) {
      return
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }

  async connect(address: TransportAddress): Promise<void> {
    if (address.transport !== this.type || !this.sockets.has(address.addr)) {
      throw new Error("unknown WebSocket client")
    }
  }

  async send(address: TransportAddress, packet: Uint8Array): Promise<void> {
    validateFipsWebSocketRecord(packet, MAX_FRAME_BYTES)
    const socket = this.sockets.get(address.addr)
    if (!socket || socket.readyState !== socket.OPEN) {
      throw new Error("WebSocket client closed")
    }
    if (socket.bufferedAmount + packet.length > MAX_FRAME_BYTES * 16) {
      throw new Error("WebSocket seed backpressure limit")
    }
    socket.send(packet)
  }

  private accept(socket: WebSocket): void {
    if (!this.context || this.sockets.size >= MAX_CONNECTIONS) {
      socket.close(1013, "connection limit")
      return
    }
    const address: TransportAddress = {
      transport: this.type,
      addr: `ws-peer://${++this.nextConnection}`,
    }
    this.sockets.set(address.addr, socket)
    socket.on("message", (raw, isBinary) => {
      if (!isBinary || !this.context) {
        socket.close(1003, "binary FIPS records only")
        return
      }
      const wire =
        raw instanceof ArrayBuffer
          ? new Uint8Array(raw)
          : Array.isArray(raw)
            ? new Uint8Array(Buffer.concat(raw))
            : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
      const hint = decodeLocalKeyHint(wire)
      if (hint?.kind === "request") {
        socket.send(
          encodeLocalKeyHintResponse(hint.nonce, this.context.localIdentity.xOnlyPubkey)
        )
        return
      }
      if (hint) {
        return
      }
      try {
        validateFipsWebSocketRecord(wire, MAX_FRAME_BYTES)
      } catch {
        socket.close(1002, "invalid FIPS record")
        return
      }
      this.context.onPacket({
        transportType: this.type,
        remoteAddr: address,
        data: new Uint8Array(wire),
        receivedAtMs: Date.now(),
      })
    })
    socket.on("close", () => {
      if (!this.sockets.delete(address.addr)) {
        return
      }
      this.context?.onConnectionState?.({remoteAddr: address, state: "disconnected"})
    })
  }
}

export async function startLocalFipsWebSocketSeed(): Promise<LocalFipsWebSocketSeed> {
  const transport = new InboundWebSocketTransport()
  const node = new FipsNode({
    identity: await generateIdentity(),
    transports: [transport],
    forwarding: true,
    routingMode: "reply_learned",
  })
  await node.start()
  return {
    url: transport.url,
    close: () => node.stop(),
  }
}
