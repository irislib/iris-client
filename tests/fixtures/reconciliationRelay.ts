import {createServer} from "node:http"
import {WebSocket, WebSocketServer} from "ws"
import {matchFilters} from "nostr-tools/filter"
import {Reconciliation} from "nostr-pubsub-reconcile"
import type {Event as NostrEvent, Filter as NostrFilter} from "nostr-tools"

/** Ordinary history deliberately omits gaps; only ID requests can recover them. */
export class ReconciliationRelayFixture {
  readonly http = createServer((_request, response) => {
    this.metadataRequests++
    response.setHeader("access-control-allow-origin", "*")
    if (this.metadataSilent) return
    response.setHeader("content-type", "application/nostr+json")
    response.end(JSON.stringify({supported_nips: this.supported ? [77] : []}))
  })
  readonly server = new WebSocketServer({server: this.http})
  readonly frames: unknown[][] = []
  readonly events: NostrEvent[] = []
  readonly ordinaryEvents: NostrEvent[] = []
  readonly clients = new Map<WebSocket, Map<string, NostrFilter[]>>()
  private releaseReply!: () => void
  private readonly replyAllowed = new Promise<void>((resolve) => {
    this.releaseReply = resolve
  })
  release(): void {
    this.releaseReply()
  }
  supported = true
  metadataSilent = false
  metadataRequests = 0
  negMode: "normal" | "silent" | "error" | "malformed" | "flood" = "normal"
  constructor() {
    this.server.on("connection", (socket) => {
      const subscriptions = new Map<string, NostrFilter[]>()
      const sessions = new Map<string, Reconciliation>()
      this.clients.set(socket, subscriptions)
      socket.on("close", () => this.clients.delete(socket))
      socket.on("message", async (raw) => {
        const frame = JSON.parse(raw.toString())
        this.frames.push(frame)
        const [type, id] = frame
        if (type === "REQ") {
          const filters = frame.slice(2) as NostrFilter[]
          subscriptions.set(id, filters)
          const candidates = filters.some((filter) => filter.ids)
            ? this.events
            : this.ordinaryEvents
          for (const event of candidates)
            if (matchFilters(filters, event))
              socket.send(JSON.stringify(["EVENT", id, event]))
          socket.send(JSON.stringify(["EOSE", id]))
        } else if (type === "CLOSE") subscriptions.delete(id)
        else if (type === "NEG-CLOSE") sessions.delete(id)
        else if (type === "NEG-OPEN" || type === "NEG-MSG") {
          if (this.negMode === "silent") return
          if (this.negMode === "error") {
            socket.send(JSON.stringify(["NEG-ERR", id, "blocked: unsupported"]))
            return
          }
          if (this.negMode === "malformed") {
            socket.send(JSON.stringify(["NEG-MSG", id, "invalid"]))
            return
          }
          if (this.negMode === "flood") {
            for (let i = 0; i < 100; i++)
              socket.send(JSON.stringify(["NEG-MSG", id, "61"]))
            return
          }
          if (type === "NEG-OPEN") {
            const filter = frame[2] as NostrFilter
            sessions.set(
              id,
              new Reconciliation(
                this.events
                  .filter((event) => matchFilters([filter], event))
                  .map((event) => ({
                    id: Uint8Array.from(Buffer.from(event.id, "hex")),
                    timestamp: BigInt(event.created_at),
                  })),
                {since: BigInt(filter.since!), until: BigInt(filter.until!)},
                {maxFrameBytes: 4096}
              )
            )
          }
          const session = sessions.get(id)
          if (!session) return
          await this.replyAllowed
          const reply = await session.respond(
            Uint8Array.from(Buffer.from(frame[type === "NEG-OPEN" ? 3 : 2], "hex"))
          )
          if (socket.readyState === WebSocket.OPEN)
            socket.send(
              JSON.stringify(["NEG-MSG", id, Buffer.from(reply).toString("hex")])
            )
        }
      })
    })
    this.http.listen(0, "127.0.0.1")
  }
  async url(): Promise<string> {
    if (!this.http.address())
      await new Promise<void>((resolve) => this.http.once("listening", resolve))
    const address = this.http.address()
    if (!address || typeof address === "string") throw new Error("Fixture not listening")
    return `ws://127.0.0.1:${address.port}/`
  }
  emit(event: NostrEvent): void {
    for (const [socket, subscriptions] of this.clients)
      for (const [id, filters] of subscriptions) {
        if (socket.readyState === WebSocket.OPEN && matchFilters(filters, event))
          socket.send(JSON.stringify(["EVENT", id, event]))
      }
  }
  async close(): Promise<void> {
    this.release()
    for (const socket of this.clients.keys()) socket.terminate()
    this.http.closeAllConnections()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
    await new Promise<void>((resolve) => this.http.close(() => resolve()))
  }
}
