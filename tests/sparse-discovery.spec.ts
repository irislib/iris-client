import {expect, test} from "@playwright/test"
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  matchFilters,
  type Event,
  type Filter,
} from "nostr-tools"
import {SocialGraph} from "nostr-social-graph"
import {WebSocketServer} from "ws"

test.use({serviceWorkers: "block"})
const seed = "336f319763657d6b0e65a5b5876719e8c8dcdcf9396852be71ee26b73368b29b"
const person = () => {
  const secret = generateSecretKey()
  return {secret, pubkey: getPublicKey(secret)}
}

for (const mode of [
  "one-follow",
  "zero-follow",
  "anonymous",
  "four-follows",
  "popular",
]) {
  test(`bounded discovery preserves originals for ${mode}`, async ({page}, testInfo) => {
    await page.setViewportSize(
      mode === "anonymous" ? {width: 390, height: 844} : {width: 1280, height: 900}
    )
    const viewer = person(),
      friend = person(),
      authors = Array.from({length: 8}, person)
    const extraFollows = Array.from({length: 3}, person)
    const fallback = mode === "zero-follow" || mode === "anonymous"
    const follows = fallback
      ? []
      : [friend, ...(mode === "four-follows" ? extraFollows : [])]
    const now = Math.floor(Date.now() / 1000) - 10
    const sign = (
      author: ReturnType<typeof person>,
      kind: number,
      content: string,
      tags: string[][] = [],
      created_at = now
    ) => finalizeEvent({kind, content, tags, created_at}, author.secret)
    const original = sign(
      friend,
      1,
      "An original from the followed account appears immediately."
    )
    const good = authors
      .slice(0, 5)
      .flatMap((author, index) => [
        sign(
          author,
          1,
          `Discovery author ${index}: original one`,
          index === 0 ? [["q", original.id]] : []
        ),
        sign(
          author,
          1,
          `Discovery author ${index}: original two`,
          index === 1 ? [["e", original.id, "", "mention"]] : [],
          now - 1
        ),
      ])
    const replies = Array.from({length: 8}, (_, i) =>
      sign(
        authors[5],
        1,
        `Reply should stay out ${i}`,
        [["e", original.id, "", "reply"]],
        now + i
      )
    )
    const hiddenMention = sign(authors[6], 1, "Hidden mention should stay out", [
      ["p", authors[7].pubkey],
    ])
    const hidden = sign(authors[7], 1, "Muted author should stay out")
    const contact = sign(
      viewer,
      3,
      "",
      follows.map((p) => ["p", p.pubkey])
    )
    const friendContacts = sign(
      friend,
      3,
      "",
      authors.map((p) => ["p", p.pubkey])
    )
    const mutes = sign(viewer, 10000, "", [["p", authors[7].pubkey]])
    const events: Event[] = [
      contact,
      friendContacts,
      mutes,
      original,
      ...good,
      ...replies,
      hiddenMention,
      hidden,
      sign(friend, 7, "+", [["e", original.id]]),
    ]
    const graph = new SocialGraph(fallback ? seed : viewer.pubkey)
    graph.handleEvent(
      mode === "four-follows"
        ? [friendContacts, mutes]
        : [contact, friendContacts, mutes],
      true,
      Infinity
    )
    if (fallback || mode === "four-follows") {
      graph.addFollower(seed, friend.pubkey)
      graph.handleEvent({...mutes, pubkey: seed}, true, Infinity)
    }
    await graph.recalculateFollowDistances()
    const binary = Buffer.from(await graph.toBinary())
    await page.route(/socialGraph[^/]*\.bin(?:\?.*)?$/, (route) =>
      route.request().resourceType() === "script"
        ? route.continue()
        : route.fulfill({contentType: "application/octet-stream", body: binary})
    )
    const server = new WebSocketServer({host: "127.0.0.1", port: 0})
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw Error("Missing fixture port")
    const relay = `ws://127.0.0.1:${address.port}`
    const selected = new Set(authors.map((a) => a.pubkey))
    const discoveryFilters: Filter[] = [],
      pending: Array<() => void> = []
    const pendingRoot: Array<() => void> = []
    let rootReleased = mode !== "four-follows"
    let released = false
    server.on("connection", (socket) =>
      socket.on("message", (raw) => {
        const [type, id, ...filters] = JSON.parse(raw.toString())
        if (type !== "REQ") return
        const discovery = filters.some(
          (filter: Filter) =>
            filter.kinds?.includes(1) &&
            filter.limit === 8 &&
            filter.authors?.some((a) => selected.has(a))
        )
        if (discovery) discoveryFilters.push(...filters)
        const send = () => {
          if (socket.readyState !== socket.OPEN) return
          const found = new Map<string, Event>()
          for (const filter of filters as Filter[]) {
            for (const event of events
              .filter((e) => matchFilters([filter], e))
              .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
              .slice(0, filter.limit ?? events.length))
              found.set(event.id, event)
          }
          for (const event of found.values())
            socket.send(JSON.stringify(["EVENT", id, event]))
          socket.send(JSON.stringify(["EOSE", id]))
        }
        const rootContacts = filters.some(
          (filter: Filter) =>
            filter.kinds?.includes(3) && filter.authors?.includes(viewer.pubkey)
        )
        if (rootContacts && !rootReleased) pendingRoot.push(send)
        else if (discovery && !released) pending.push(send)
        else send()
      })
    )
    try {
      await page.addInitScript(
        ({publicKey, relay, activeFeed}) => {
          localStorage.setItem(
            "user-storage",
            JSON.stringify({
              version: 3,
              state: {
                publicKey,
                privateKey: "",
                relays: [relay],
                relayConfigs: [{url: relay}],
                ndkOutboxModel: false,
                autoConnectUserRelays: false,
                followRelayHints: false,
              },
            })
          )
          if (activeFeed)
            localStorage.setItem(
              "feed-storage",
              JSON.stringify({version: 2, state: {activeFeed}})
            )
        },
        {
          publicKey: mode === "anonymous" ? "" : viewer.pubkey,
          relay,
          activeFeed: mode === "popular" ? "popular" : "",
        }
      )
      if (mode === "four-follows") {
        // The saved graph knows the fallback network but has never received
        // this viewer's contacts. Unknown must not be treated as known-empty.
        await page.route("**/__discovery-seed", (route) =>
          route.fulfill({contentType: "text/html", body: "<!doctype html>"})
        )
        await page.goto("/__discovery-seed")
        await page.evaluate(
          ({data, seed}) =>
            new Promise<void>((resolve, reject) => {
              const request = indexedDB.open("localforage", 2)
              request.onupgradeneeded = () =>
                request.result.createObjectStore("keyvaluepairs")
              request.onerror = () => reject(request.error)
              request.onsuccess = () => {
                const database = request.result,
                  transaction = database.transaction("keyvaluepairs", "readwrite")
                transaction
                  .objectStore("keyvaluepairs")
                  .put({data: new Uint8Array(data), readyRoot: seed}, "socialGraph")
                transaction.oncomplete = () => {
                  database.close()
                  resolve()
                }
                transaction.onerror = () => reject(transaction.error)
              }
            }),
          {data: [...binary], seed}
        )
      }
      await page.goto("/")
      if (mode === "four-follows") {
        await expect.poll(() => pendingRoot.length).toBeGreaterThan(0)
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
        )
        expect(discoveryFilters).toHaveLength(0)
        rootReleased = true
        pendingRoot.splice(0).forEach((send) => send())
      }
      const items = page.locator('#main-content [data-testid="feed-item"]')
      await expect(items.filter({hasText: original.content}).first()).toBeVisible({
        timeout: 15000,
      })
      const before = await items.evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-event-id"))
      )
      const disabled = mode === "four-follows" || mode === "popular"
      if (disabled) {
        if (mode === "popular")
          await expect(
            page.getByRole("button", {name: "Popular", exact: true})
          ).toHaveClass(/btn-primary/)
        await expect.poll(() => discoveryFilters.length).toBe(0)
        expect(await items.count()).toBeGreaterThan(0)
        return
      }
      await expect.poll(() => discoveryFilters.length).toBeGreaterThan(0)
      released = true
      pending.splice(0).forEach((send) => send())
      await expect.poll(() => items.count()).toBeGreaterThanOrEqual(10)
      const after = await items.evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-event-id"))
      )
      expect(after.slice(0, before.length)).toEqual(before)
      expect(new Set(after).size).toBe(after.length)
      for (const event of [...replies, hiddenMention, hidden])
        await expect(items.filter({hasText: event.content})).toHaveCount(0)
      expect(
        discoveryFilters.every(
          (f) => f.authors?.length === 1 && f.kinds?.length === 1 && f.limit === 8
        )
      ).toBe(true)
      expect(
        new Set(discoveryFilters.flatMap((f) => f.authors || [])).size
      ).toBeLessThanOrEqual(8)
      if (mode === "one-follow") {
        // The existing sidebar samples graph counts every two seconds. Wait
        // for that display before capturing; the feed already used this root.
        await expect(
          page.getByText("1 hop", {exact: true}).locator("..").locator(".font-bold")
        ).toHaveText("1")
        await expect(
          page.getByText("2 hops", {exact: true}).locator("..").locator(".font-bold")
        ).toHaveText("8")
      }
      await page.screenshot({path: testInfo.outputPath(`sparse-${mode}.png`)})
    } finally {
      server.clients.forEach((socket) => socket.terminate())
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}
