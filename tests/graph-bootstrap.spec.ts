import {expect, test} from "@playwright/test"
import {readFile} from "node:fs/promises"
import {SocialGraph} from "nostr-social-graph"
import {WebSocketServer} from "ws"
import manifest from "../src/assets/socialGraph.json" with {type: "json"}

const oldRoot = "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0"
const account = "a".repeat(64)
const friend = "b".repeat(64)
const muted = "c".repeat(64)

for (const cached of [false, true]) {
  test(`${cached ? "legacy cached" : "cold anonymous"} discovery uses the real company bundle and preserves personal lists`, async ({
    page,
  }, testInfo) => {
    const bundled = await SocialGraph.fromBinary(
      manifest.root,
      await readFile(new URL("../src/assets/socialGraph.bin", import.meta.url))
    )
    const requests: {kinds?: number[]; authors?: string[]}[] = []
    const server = new WebSocketServer({host: "127.0.0.1", port: 0})
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("No fixture port")
    const relay = `ws://127.0.0.1:${address.port}`
    server.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const [type, id, ...filters] = JSON.parse(raw.toString())
        if (type === "REQ") {
          requests.push(...filters)
          socket.send(JSON.stringify(["EOSE", id]))
        }
      })
    })
    try {
      await page.addInitScript((relay) => {
        localStorage.setItem(
          "user-storage",
          JSON.stringify({
            version: 3,
            state: {
              publicKey: "",
              privateKey: "",
              relays: [relay],
              relayConfigs: [{url: relay}],
              ndkOutboxModel: false,
              autoConnectUserRelays: false,
              followRelayHints: false,
            },
          })
        )
      }, relay)
      if (cached) {
        const previous = new SocialGraph(oldRoot)
        previous.handleEvent(
          [
            {kind: 3, pubkey: oldRoot, created_at: 10, tags: [["p", account]]},
            {kind: 3, pubkey: account, created_at: 20, tags: [["p", friend]]},
            {kind: 10000, pubkey: account, created_at: 30, tags: [["p", muted]]},
          ].map((event) => ({...event, id: "", sig: "", content: ""})),
          true,
          Infinity
        )
        await page.route("**/__graph-seed", (route) =>
          route.fulfill({contentType: "text/html", body: "<!doctype html>"})
        )
        await page.goto("/__graph-seed")
        await page.evaluate(
          ({data, readyRoot}) =>
            new Promise<void>((resolve, reject) => {
              const opening = indexedDB.open("localforage", 2)
              opening.onupgradeneeded = () =>
                opening.result.createObjectStore("keyvaluepairs")
              opening.onerror = () => reject(opening.error)
              opening.onsuccess = () => {
                const db = opening.result
                const tx = db.transaction("keyvaluepairs", "readwrite")
                tx.objectStore("keyvaluepairs").put(
                  {data: new Uint8Array(data), readyRoot},
                  "socialGraph"
                )
                tx.oncomplete = () => {
                  db.close()
                  resolve()
                }
                tx.onerror = () => reject(tx.error)
              }
            }),
          {data: Array.from(await previous.toBinary()), readyRoot: account}
        )
      }

      await page.goto("/")
      const expectedAuthors = [...bundled.getFollowedByUser(manifest.root)].sort()
      await expect
        .poll(() =>
          requests.some(
            (filter) =>
              filter.kinds?.some((kind) => kind === 6 || kind === 7) &&
              JSON.stringify(filter.authors?.slice().sort()) ===
                JSON.stringify(expectedAuthors)
          )
        )
        .toBe(true)

      await page.goto("/settings/social-graph")
      await expect(
        page.getByText("Distance 1", {exact: true}).locator("..").locator("span").last()
      ).toHaveText(String(manifest.directFollows))
      const download = page.waitForEvent("download")
      await page.getByRole("button", {name: "Save to file", exact: true}).click()
      const stream = await (await download).createReadStream()
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(Buffer.from(chunk))
      const graph = await SocialGraph.fromBinary(manifest.root, Buffer.concat(chunks))
      expect(graph.getFollowedByUser(manifest.root)).toEqual(new Set(expectedAuthors))
      expect(graph.size().sizeByDistance[2]).toBe(manifest.secondDegree)
      for (const [id, targets] of bundled.getInternalData().mutedByUser) {
        const {str} = bundled.getInternalData()
        expect(graph.getMutedByUser(str(id))).toEqual(new Set([...targets].map(str)))
      }
      if (cached) {
        expect(graph.getFollowedByUser(account)).toEqual(new Set([friend]))
        expect(graph.getMutedByUser(account)).toEqual(new Set([muted]))
        expect(graph.getFollowListCreatedAt(account)).toBe(20)
        expect(graph.getMuteListCreatedAt(account)).toBe(30)
      }
      await page
        .getByRole("heading", {name: "Statistics", exact: true})
        .scrollIntoViewIfNeeded()
      await page.screenshot({path: testInfo.outputPath("company-bootstrap.png")})
    } finally {
      server.clients.forEach((socket) => socket.terminate())
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}
