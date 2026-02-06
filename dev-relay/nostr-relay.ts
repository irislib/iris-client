import {createServer} from "node:http"
import WebSocket, {WebSocketServer} from "ws"
import {matchFilter, type Filter, type VerifiedEvent} from "nostr-tools"

export type NostrEvent = VerifiedEvent

type NostrClientMessage =
  | ["REQ", string, ...Filter[]]
  | ["EVENT", NostrEvent]
  | ["CLOSE", string]
  | ["COUNT", string, Filter]
  | [string, ...unknown[]]

type NostrRelayMessage =
  | ["EVENT", string, NostrEvent]
  | ["EOSE", string]
  | ["OK", string, boolean, string]
  | ["NOTICE", string]
  | ["COUNT", string, {count: number}]

export interface NostrRelayOptions {
  host?: string
  port?: number
  /**
   * Optional preloaded events (used for tests / CI seeding).
   * These are treated like stored relay events.
   */
  initialEvents?: NostrEvent[]
  /**
   * Emit very chatty logs (connections, subscriptions, etc).
   */
  debug?: boolean
}

export interface NostrRelayHandle {
  /** ws:// URL */
  url: string
  host: string
  port: number
  eventCount: () => number
  close: () => Promise<void>
}

type Subscription = {
  id: string
  filters: Filter[]
  deliveredIds: Set<string>
}

class InMemoryEventStore {
  private eventsById = new Map<string, NostrEvent>()
  private eventsSorted: NostrEvent[] = [] // created_at desc
  private deletedIds = new Set<string>()
  private latestReplaceableByKey = new Map<string, {id: string; created_at: number}>()

  constructor(initialEvents?: NostrEvent[]) {
    if (initialEvents && initialEvents.length > 0) {
      for (const e of initialEvents) this.acceptEvent(e)
      this.eventsSorted.sort((a, b) => b.created_at - a.created_at)
    }
  }

  count(): number {
    return this.eventsById.size
  }

  acceptEvent(event: NostrEvent): {stored: boolean; notice?: string} {
    if (!event || typeof event !== "object") {
      return {stored: false, notice: "invalid event"}
    }
    if (!event.id || typeof event.id !== "string") {
      return {stored: false, notice: "missing event id"}
    }
    if (this.eventsById.has(event.id)) {
      return {stored: false}
    }

    // Kind 5: deletion. Keep it stored, but also mark referenced ids as deleted.
    if (event.kind === 5) {
      for (const tag of event.tags || []) {
        if (tag?.[0] === "e" && tag[1]) this.deletedIds.add(tag[1])
      }
      this.insert(event)
      return {stored: true}
    }

    // Ephemeral kinds (20000-29999): don't store.
    if (event.kind >= 20000 && event.kind < 30000) {
      return {stored: false}
    }

    const key = replaceableKey(event)
    if (key) {
      const current = this.latestReplaceableByKey.get(key)
      if (current && current.created_at > event.created_at) {
        // Older than what we already have; ignore.
        return {stored: false}
      }
      this.latestReplaceableByKey.set(key, {id: event.id, created_at: event.created_at})
    }

    this.insert(event)
    return {stored: true}
  }

  private insert(event: NostrEvent) {
    this.eventsById.set(event.id, event)
    // Insert into eventsSorted while preserving created_at desc order.
    // This is O(n) but incremental inserts during e2e are low volume.
    let lo = 0
    let hi = this.eventsSorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.eventsSorted[mid].created_at < event.created_at) {
        hi = mid
      } else {
        lo = mid + 1
      }
    }
    this.eventsSorted.splice(lo, 0, event)
  }

  query(filters: Filter[]): NostrEvent[] {
    const out: NostrEvent[] = []
    const seen = new Set<string>()

    for (const f of filters) {
      const limit = typeof f.limit === "number" ? Math.max(0, f.limit) : Infinity
      if (limit === 0) continue

      let matchedForThisFilter = 0
      for (const event of this.eventsSorted) {
        if (matchedForThisFilter >= limit) break
        if (seen.has(event.id)) continue
        if (this.deletedIds.has(event.id)) continue

        const key = replaceableKey(event)
        if (key) {
          const current = this.latestReplaceableByKey.get(key)
          if (current?.id !== event.id) continue
        }

        if (matchFilter(f, event)) {
          out.push(event)
          seen.add(event.id)
          matchedForThisFilter++
        }
      }
    }

    // Keep stable-ish ordering for clients (newest first).
    out.sort((a, b) => b.created_at - a.created_at)
    return out
  }

  countMatching(filter: Filter): number {
    let count = 0
    for (const event of this.eventsSorted) {
      if (this.deletedIds.has(event.id)) continue
      const key = replaceableKey(event)
      if (key) {
        const current = this.latestReplaceableByKey.get(key)
        if (current?.id !== event.id) continue
      }
      if (matchFilter(filter, event)) count++
    }
    return count
  }
}

function replaceableKey(
  event: Pick<NostrEvent, "kind" | "pubkey" | "tags">
): string | null {
  const {kind, pubkey} = event
  if (!pubkey) return null

  const isReplaceable =
    kind === 0 ||
    kind === 3 ||
    (kind >= 10000 && kind < 20000) ||
    (kind >= 30000 && kind < 40000)

  if (!isReplaceable) return null

  // Parameterized replaceable events (30000-39999) use the "d" tag as part of the address.
  if (kind >= 30000 && kind < 40000) {
    const d = event.tags?.find((t) => t?.[0] === "d")?.[1] ?? ""
    return `${kind}:${pubkey}:${d}`
  }

  return `${kind}:${pubkey}`
}

function safeSend(ws: WebSocket, msg: NostrRelayMessage) {
  try {
    ws.send(JSON.stringify(msg))
  } catch {
    // ignore
  }
}

export async function startNostrRelay(
  opts: NostrRelayOptions = {}
): Promise<NostrRelayHandle> {
  const host = opts.host ?? "127.0.0.1"
  const port = opts.port ?? 7777
  const debug = !!opts.debug
  const store = new InMemoryEventStore(opts.initialEvents)

  const log = (...args: unknown[]) => {
    if (!debug) return
    // eslint-disable-next-line no-console
    console.log("[node-relay]", ...args)
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)

    if (url.pathname === "/health") {
      res.statusCode = 200
      res.setHeader("content-type", "application/json; charset=utf-8")
      res.end(JSON.stringify({ok: true, events: store.count()}))
      return
    }

    res.statusCode = 404
    res.setHeader("content-type", "text/plain; charset=utf-8")
    res.end("not found")
  })

  const wss = new WebSocketServer({server})

  // Keep subscriptions per-connection.
  const subsBySocket = new WeakMap<WebSocket, Map<string, Subscription>>()

  const broadcastEvent = (event: NostrEvent) => {
    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue
      const subs = subsBySocket.get(ws)
      if (!subs) continue

      for (const sub of subs.values()) {
        if (sub.deliveredIds.has(event.id)) continue
        if (sub.filters.some((f) => matchFilter(f, event))) {
          safeSend(ws, ["EVENT", sub.id, event])
          sub.deliveredIds.add(event.id)
        }
      }
    }
  }

  wss.on("connection", (ws: WebSocket) => {
    log("connection")
    const subs = new Map<string, Subscription>()
    subsBySocket.set(ws, subs)

    ws.on("message", (data: WebSocket.RawData) => {
      let parsed: NostrClientMessage
      try {
        parsed = JSON.parse(String(data))
      } catch {
        safeSend(ws, ["NOTICE", "invalid json"])
        return
      }

      const [type] = parsed
      if (type === "REQ") {
        const [_t, subId, ...filters] = parsed as ["REQ", string, ...Filter[]]
        if (!subId) return
        const f = filters.length > 0 ? filters : [{} as Filter]
        const sub: Subscription = {id: subId, filters: f, deliveredIds: new Set()}
        subs.set(subId, sub)

        const events = store.query(f)
        for (const ev of events) {
          safeSend(ws, ["EVENT", subId, ev])
          sub.deliveredIds.add(ev.id)
        }
        safeSend(ws, ["EOSE", subId])
        return
      }

      if (type === "CLOSE") {
        const [_t, subId] = parsed as ["CLOSE", string]
        subs.delete(subId)
        return
      }

      if (type === "COUNT") {
        const [_t, subId, filter] = parsed as ["COUNT", string, Filter]
        if (!subId || !filter) return
        const count = store.countMatching(filter)
        safeSend(ws, ["COUNT", subId, {count}])
        return
      }

      if (type === "EVENT") {
        const [_t, event] = parsed as ["EVENT", NostrEvent]
        const {stored, notice} = store.acceptEvent(event)
        if (notice) safeSend(ws, ["NOTICE", notice])
        safeSend(ws, ["OK", event?.id ?? "", true, ""])
        if (stored) broadcastEvent(event)
        return
      }

      // Ignore everything else.
    })

    ws.on("close", () => {
      log("close")
      subs.clear()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => resolve())
  })

  const address = server.address()
  const actualPort =
    typeof address === "object" && address && "port" in address ? address.port : port

  log(`listening on ws://${host}:${actualPort} (events=${store.count()})`)

  return {
    url: `ws://${host}:${actualPort}`,
    host,
    port: actualPort,
    eventCount: () => store.count(),
    close: async () => {
      for (const ws of wss.clients) {
        try {
          ws.close()
        } catch {
          // ignore
        }
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      )
    },
  }
}
