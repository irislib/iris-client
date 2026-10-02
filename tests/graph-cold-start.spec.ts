import {expect, test} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, matchFilters} from "nostr-tools"
import {SocialGraph} from "nostr-social-graph"
import {WebSocketServer, type WebSocket} from "ws"

// Asset routing must reach this fixture, not a precached production graph.
test.use({serviceWorkers: "block"})

// Exercise real cold graph hydration and the relay worker, including a relay
// that accepts requests but never completes history.
for (const scenario of ["personal", "discovery", "late-personal"]) {
  const discovery = scenario !== "personal"
  const latePersonal = scenario === "late-personal"
  test(`cold ${scenario} For You hydrates mutes and posts without waiting for a silent relay`, async ({
    page,
  }) => {
    const user = () => {
      const secret = generateSecretKey()
      return {secret, pubkey: getPublicKey(secret)}
    }
    const viewer = user(),
      friend = user(),
      muted = user()
    const now = Math.floor(Date.now() / 1000) - 2
    const sign = (
      author: ReturnType<typeof user>,
      kind: number,
      content: string,
      tags: string[][] = []
    ) => finalizeEvent({kind, content, tags, created_at: now}, author.secret)
    const visible = sign(friend, 1, `healthy cold post ${viewer.pubkey}`)
    const hidden = sign(muted, 1, `muted cold post ${viewer.pubkey}`)
    const events = [
      sign(
        viewer,
        3,
        "",
        discovery
          ? []
          : [
              ["p", friend.pubkey],
              ["p", muted.pubkey],
            ]
      ),
      sign(viewer, 10000, "", [["p", muted.pubkey]]),
      sign(friend, 3, "", []),
      sign(friend, 10000, "", []),
      visible,
      hidden,
    ]
    const server = new WebSocketServer({port: 0, host: "127.0.0.1"})
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address()
    if (typeof address !== "object" || !address) throw Error("No fixture address")
    const url = `ws://127.0.0.1:${address.port}`
    let rootCompleted = false,
      opinionsCompleted = false
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const rootRequests = new Map<WebSocket, Set<string>>()
    server.on("connection", (socket, request) => {
      socket.on("message", (raw) => {
        const [type, id, ...filters] = JSON.parse(raw.toString())
        if (type !== "REQ" || request.url === "/silent") return
        const selected = events.filter((event) => matchFilters(filters, event))
        const isGraph = filters.some((filter: {kinds?: number[]}) =>
          filter.kinds?.includes(3)
        )
        const isRoot = filters.some((filter: {authors?: string[]}) =>
          filter.authors?.includes(viewer.pubkey)
        )
        if (isGraph && isRoot) {
          const ids = rootRequests.get(socket) ?? new Set<string>()
          ids.add(id)
          rootRequests.set(socket, ids)
        }
        for (const event of selected.filter((event) => event.kind !== 10000)) {
          socket.send(JSON.stringify(["EVENT", id, event]))
        }
        const graphDelay = latePersonal && !isRoot ? 1200 : 150
        const timer = setTimeout(
          () => {
            if (socket.readyState !== socket.OPEN) return
            for (const event of selected.filter((event) => event.kind === 10000)) {
              socket.send(JSON.stringify(["EVENT", id, event]))
            }
            socket.send(JSON.stringify(["EOSE", id]))
            if (isGraph) {
              if (isRoot) rootCompleted = true
              else opinionsCompleted = true
            }
          },
          isGraph ? graphDelay : 0
        )
        timers.add(timer)
      })
    })
    try {
      const graph = new SocialGraph(viewer.pubkey)
      if (discovery) {
        graph.addFollower(
          "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0",
          friend.pubkey
        )
        graph.addFollower(
          "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0",
          muted.pubkey
        )
        await graph.recalculateFollowDistances()
      }
      let bundledGraphRequests = 0
      const binary = Buffer.from(await graph.toBinary())
      await page.route(/socialGraph[^/]*\.bin(?:\?.*)?$/, async (route) => {
        if (route.request().resourceType() === "script") return route.continue()
        bundledGraphRequests++
        if (latePersonal) {
          const contacts = finalizeEvent(
            {
              kind: 3,
              created_at: now + 1,
              content: "",
              tags: [
                ["p", friend.pubkey],
                ["p", muted.pubkey],
              ],
            },
            viewer.secret
          )
          for (const [socket, ids] of rootRequests) {
            for (const id of ids) socket.send(JSON.stringify(["EVENT", id, contacts]))
          }
          // Keep the discovery fetch open while the newer contacts start an
          // opinion query whose mute/history response deliberately arrives later.
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
        return route.fulfill({contentType: "application/octet-stream", body: binary})
      })
      await page.addInitScript(
        ({publicKey, urls, forbidden}) => {
          localStorage.setItem(
            "user-storage",
            JSON.stringify({
              version: 3,
              state: {
                publicKey,
                privateKey: "",
                nip07Login: false,
                relays: urls,
                relayConfigs: urls.map((url) => ({url})),
                ndkOutboxModel: false,
                autoConnectUserRelays: false,
                followRelayHints: false,
              },
            })
          )
          Object.assign(window, {__mutedPostPainted: false})
          new MutationObserver(() => {
            if (
              [
                ...document.querySelectorAll('#main-content [data-testid="feed-item"]'),
              ].some((element) => element.textContent?.includes(forbidden))
            ) {
              Object.assign(window, {__mutedPostPainted: true})
            }
          }).observe(document, {childList: true, subtree: true})
        },
        {
          publicKey: viewer.pubkey,
          urls: [`${url}/healthy`, `${url}/silent`],
          forbidden: hidden.content,
        }
      )
      const start = Date.now()
      await page.goto("/")
      await expect(
        page
          .locator('#main-content [data-testid="feed-item"]')
          .filter({hasText: visible.content})
          .first()
      ).toBeVisible({timeout: 4000})
      expect(Date.now() - start).toBeLessThan(4500)
      expect(rootCompleted).toBe(true)
      expect(opinionsCompleted).toBe(!discovery || latePersonal)
      expect(bundledGraphRequests).toBe(discovery ? 1 : 0)
      expect(await page.evaluate(() => Reflect.get(window, "__mutedPostPainted"))).toBe(
        false
      )
      await expect(
        page
          .locator('#main-content [data-testid="feed-item"]')
          .filter({hasText: hidden.content})
      ).toHaveCount(0)
    } finally {
      timers.forEach(clearTimeout)
      server.clients.forEach((socket) => socket.terminate())
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}
