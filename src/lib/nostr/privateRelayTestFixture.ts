import {WebSocket, WebSocketServer} from "ws"
import {matchFilters} from "nostr-tools/filter"
import type {NostrEvent, NostrFilter} from "nostr-pubsub"

export class RuntimeRelayFixture {
  readonly server: WebSocketServer
  readonly requests: NostrFilter[][] = []
  readonly rejectedRequests: NostrFilter[][] = []
  readonly events: NostrEvent[] = []
  readonly clients = new Map<WebSocket, Map<string, NostrFilter[]>>()
  acknowledge: boolean | "silent" = true
  eoseDelay = 0
  maxFilters = Infinity
  requireAuth = false
  authEvents: NostrEvent[] = []
  readonly frames = new Map<WebSocket, unknown[][]>()
  constructor() {
    this.server = new WebSocketServer({host: "127.0.0.1", port: 0})
    this.server.on("connection", (socket) => {
      const subscriptions = new Map<string, NostrFilter[]>()
      let authenticated = !this.requireAuth
      if (this.requireAuth)
        socket.send(JSON.stringify(["AUTH", "runtime-test-challenge"]))
      this.clients.set(socket, subscriptions)
      this.frames.set(socket, [])
      socket.on("close", () => this.clients.delete(socket))
      socket.on("message", (raw) => {
        const [type, id, ...rest] = JSON.parse(raw.toString())
        this.frames.get(socket)!.push([type, id, ...rest])
        if (type === "AUTH") {
          this.authEvents.push(id)
          authenticated = true
          socket.send(JSON.stringify(["OK", id.id, true, ""]))
        } else if (type === "REQ") {
          if (!authenticated) {
            socket.send(JSON.stringify(["CLOSED", id, "auth-required: sign in"]))
            return
          }
          const filters = rest as NostrFilter[]
          this.requests.push(filters)
          if (filters.length > this.maxFilters) {
            this.rejectedRequests.push(filters)
            socket.send(
              JSON.stringify(["CLOSED", id, `too many filters (max ${this.maxFilters})`])
            )
            return
          }
          subscriptions.set(id, filters)
          const events = new Map<string, NostrEvent>()
          for (const filter of filters) {
            for (const event of this.events
              .filter((event) => matchFilters([filter], event))
              .sort((a, b) => b.created_at - a.created_at)
              .slice(0, filter.limit))
              events.set(event.id, event)
          }
          for (const event of events.values())
            socket.send(JSON.stringify(["EVENT", id, event]))
          setTimeout(() => {
            if (socket.readyState === WebSocket.OPEN && subscriptions.has(id))
              socket.send(JSON.stringify(["EOSE", id]))
          }, this.eoseDelay)
        } else if (type === "CLOSE") subscriptions.delete(id)
        else if (type === "EVENT") {
          const event = id as NostrEvent
          if (!authenticated) {
            socket.send(JSON.stringify(["OK", event.id, false, "auth-required: sign in"]))
            return
          }
          if (this.acknowledge === "silent") return
          socket.send(
            JSON.stringify([
              "OK",
              event.id,
              this.acknowledge,
              this.acknowledge ? "" : "rejected",
            ])
          )
          if (this.acknowledge) this.emit(event)
        }
      })
    })
  }
  async url(): Promise<string> {
    if (!this.server.address())
      await new Promise<void>((resolve) => this.server.once("listening", resolve))
    const address = this.server.address()
    if (!address || typeof address === "string") throw new Error("Relay not listening")
    return `ws://127.0.0.1:${address.port}/`
  }
  emit(event: NostrEvent): void {
    if (!this.events.some((old) => old.id === event.id)) this.events.push(event)
    for (const [socket, subscriptions] of this.clients)
      if (socket.readyState === WebSocket.OPEN) {
        for (const [id, filters] of subscriptions)
          if (matchFilters(filters, event))
            socket.send(JSON.stringify(["EVENT", id, event]))
      }
  }
  disconnect(): void {
    for (const socket of this.clients.keys()) socket.terminate()
  }
  async close(): Promise<void> {
    this.disconnect()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }
}
export async function until(predicate: () => boolean, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Condition not reached")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
