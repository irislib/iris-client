import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, generateSecretKey, Relay, type Filter} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

async function retainedIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases()
    const name = databases.find((db) =>
      db.name?.startsWith("hashtree:public-peers:")
    )?.name
    if (!name) return []
    return new Promise<string[]>((resolve, reject) => {
      const open = indexedDB.open(name)
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const request = db.transaction("snapshots").objectStore("snapshots").get("events")
        request.onsuccess = () => {
          db.close()
          resolve((request.result?.events ?? []).map((event: {id: string}) => event.id))
        }
        request.onerror = () => {
          db.close()
          reject(request.error)
        }
      }
    })
  })
}

test("peer discovery bounds history on startup and reload while retaining live announcements", async ({
  page,
  context,
}) => {
  const now = Math.floor(Date.now() / 1000)
  const advert = (created_at: number) =>
    finalizeEvent(
      {
        kind: 37195,
        created_at,
        tags: [
          ["d", "iris-client"],
          ["protocol", "iris-client"],
          ["version", "1"],
          ["expiration", String(created_at + 3600)],
        ],
        content: JSON.stringify({
          identifier: "fips-overlay-v1",
          version: 1,
          endpoints: [],
          stunServers: [],
        }),
      },
      generateSecretKey()
    )
  const recent = Array.from({length: 80}, () => advert(now - 60))
  const expired = Array.from({length: 80}, () => advert(now - 7200))
  const requests: Filter[] = []
  const received = new Set<string>()
  let completed = 0
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [...recent, ...expired],
    onRequest: (filters) =>
      requests.push(...filters.filter((filter) => filter.kinds?.includes(37195))),
  })
  await context.addInitScript(
    (url) => {
      window.__HTREE_SERVER_URL__ = url
    },
    relay.url.replace("ws:", "http:")
  )
  await context.route("https://**/*", (route) => route.abort())
  await page.routeWebSocket("wss://**/*", (socket) => socket.close())
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).host !== new URL(relay.url).host) return
    const discovery = new Set<string>()
    socket.on("framesent", ({payload}) => {
      const [type, id, ...filters] = JSON.parse(String(payload))
      if (
        type === "REQ" &&
        filters.some((filter: Filter) => filter.kinds?.includes(37195))
      )
        discovery.add(id)
    })
    socket.on("framereceived", ({payload}) => {
      const [type, id, event] = JSON.parse(String(payload))
      if (!discovery.has(id)) return
      if (type === "EVENT") received.add(event.id)
      if (type === "EOSE") completed++
    })
  })
  let publisher: Relay | undefined
  try {
    await signUp(page, "Peer discovery")
    await expect.poll(() => requests.length).toBeGreaterThan(0)
    await expect.poll(() => completed).toBeGreaterThan(0)
    for (const filter of requests) {
      expect(filter.limit).toBe(64)
      expect(filter.since).toBeGreaterThanOrEqual(now - 3600)
      expect(filter.since).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))
    }
    // The browser's own newly published announcement can occupy one history slot.
    const historicalPeers = recent.filter((event) => received.has(event.id)).length
    expect(historicalPeers).toBeGreaterThanOrEqual(63)
    expect(historicalPeers).toBeLessThanOrEqual(64)
    expect(expired.some((event) => received.has(event.id))).toBe(false)

    publisher = await Relay.connect(relay.url)
    const live = advert(Math.floor(Date.now() / 1000))
    await publisher.publish(live)
    await expect.poll(() => retainedIds(page)).toContain(live.id)

    const beforeReload = requests.length
    const beforeComplete = completed
    await page.reload()
    await expect.poll(() => completed).toBeGreaterThan(beforeComplete)
    expect(requests.length).toBeGreaterThan(beforeReload)
    for (const filter of requests.slice(beforeReload)) {
      expect(filter.limit).toBe(64)
      expect(filter.since).toBeGreaterThanOrEqual(now - 3600)
    }
    const afterReload = advert(Math.floor(Date.now() / 1000))
    await publisher.publish(afterReload)
    await expect.poll(() => retainedIds(page)).toContain(afterReload.id)
  } finally {
    publisher?.close()
    await page.close()
    await relay.close()
  }
})
