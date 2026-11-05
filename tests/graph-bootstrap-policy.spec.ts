import {expect, test, type Page} from "@playwright/test"
import {SocialGraph} from "nostr-social-graph"
import manifest from "../src/assets/socialGraph.json" with {type: "json"}
import {freshGraphBootstrap} from "./utils/graph-bootstrap"

test.use({serviceWorkers: "block"})
test.skip(
  ![process.env.IRIS_E2E_BUILT_DIST, process.env.IRIS_E2E_BUILT].some((value) =>
    ["true", "1"].includes(value || "")
  ),
  "Verify the production bundle, including its real bootstrap import"
)

const publicRelays = [
  "wss://temp.iris.to/",
  "wss://vault.iris.to/",
  "wss://relay.damus.io/",
  "wss://relay.snort.social/",
  "wss://relay.primal.net/",
  "wss://nos.lol/",
]
const account = "a".repeat(64)
const friend = "b".repeat(64)
const muted = "c".repeat(64)
const discovered = "d".repeat(64)

function setList(graph: SocialGraph, pubkey: string, kind: 3 | 10000, targets: string[]) {
  graph.handleEvent(
    {
      pubkey,
      kind,
      tags: targets.map((key) => ["p", key]),
      created_at: 20,
      content: "",
      id: "",
      sig: "",
    },
    true,
    Infinity
  )
}

async function fixtureGraph() {
  const graph = new SocialGraph(manifest.root)
  setList(graph, manifest.root, 3, [discovered])
  return Buffer.from(await graph.toBinary())
}

async function seedGraph(page: Page, graph: SocialGraph) {
  await page.route("**/__graph-seed", (route) =>
    route.fulfill({contentType: "text/html", body: "<!doctype html>"})
  )
  await page.goto("/__graph-seed")
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open("localforage", 2)
        opening.onupgradeneeded = () => opening.result.createObjectStore("keyvaluepairs")
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => {
          const db = opening.result
          const tx = db.transaction("keyvaluepairs", "readwrite")
          tx.objectStore("keyvaluepairs").put(new Uint8Array(data), "socialGraph")
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    Array.from(await graph.toBinary())
  )
}

async function exportedGraph(page: Page) {
  const downloaded = page.waitForEvent("download")
  await page.getByRole("button", {name: "Save to file", exact: true}).click()
  const stream = await (await downloaded).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return SocialGraph.fromBinary(manifest.root, Buffer.concat(chunks))
}

async function configure(page: Page, scope = "default") {
  const sockets: string[] = []
  const catchupRequests: string[] = []
  await page.routeWebSocket(/^(?:wss?:\/\/)/, (socket) => {
    sockets.push(socket.url())
    socket.onMessage((raw) => {
      if (typeof raw !== "string" || !raw.startsWith("[")) return
      const [type, id, filter] = JSON.parse(String(raw))
      if (
        type === "NEG-OPEN" &&
        filter?.kinds?.includes(3) &&
        filter.kinds.includes(10000)
      ) {
        catchupRequests.push(socket.url())
        socket.send(JSON.stringify(["NEG-ERR", id, "Fixture uses ordinary REQ"]))
      }
      if (type === "REQ") socket.send(JSON.stringify(["EOSE", id]))
    })
  })
  await page.addInitScript(
    ({scope, publicRelays}) => {
      let relays = publicRelays
      if (scope === "custom") relays = ["wss://custom.test/"]
      if (scope === "empty") relays = []
      localStorage.setItem(
        "user-storage",
        JSON.stringify({
          version: 3,
          state: {
            publicKey: "",
            privateKey: "",
            relays: scope === "disabled" ? [] : relays,
            relayConfigs: relays.map((url) => ({url, disabled: scope === "disabled"})),
            ndkOutboxModel: false,
            autoConnectUserRelays: false,
            followRelayHints: false,
          },
        })
      )
      if (scope === "native") window.__HTREE_SERVER_URL__ = "http://127.0.0.1:7799"
    },
    {scope, publicRelays}
  )
  return {sockets, catchupRequests}
}

for (const retained of [false, true]) {
  test(`default HTTP bootstrap imports real binary in ${retained ? "retained" : "empty"} graph`, async ({
    page,
  }, testInfo) => {
    const {sockets, catchupRequests} = await configure(page)
    const body = await fixtureGraph()
    let requests = 0
    await page.route(freshGraphBootstrap, (route) => {
      requests++
      return route.fulfill({
        body,
        contentType: "application/octet-stream",
        headers: {
          "x-graph-root": manifest.root,
          "access-control-expose-headers": "x-graph-root",
        },
      })
    })
    if (retained) {
      const personal = new SocialGraph(account)
      setList(personal, account, 3, [friend])
      setList(personal, account, 10000, [muted])
      await seedGraph(page, personal)
    }
    await page.goto("/settings/social-graph")
    await expect(
      page.getByText("Distance 1", {exact: true}).locator("..").locator("span").last()
    ).toHaveText("1")
    const graph = await exportedGraph(page)
    expect(requests).toBe(1)
    expect(graph.getFollowedByUser(manifest.root)).toEqual(new Set([discovered]))
    await expect
      .poll(() => sockets.some((url) => url.startsWith("wss://graph-relay.iris.to")))
      .toBe(true)
    await expect.poll(() => catchupRequests.length).toBeGreaterThan(0)
    if (retained) {
      expect(graph.getFollowedByUser(account)).toEqual(new Set([friend]))
      expect(graph.getMutedByUser(account)).toEqual(new Set([muted]))
      expect(graph.getFollowListCreatedAt(account)).toBe(20)
      expect(graph.getMuteListCreatedAt(account)).toBe(20)
    }
    // A retained snapshot must remain the authority on reload, without another HTTP bootstrap.
    await seedGraph(page, graph)
    await page.goto("/settings/social-graph")
    await expect(
      page.getByText("Distance 1", {exact: true}).locator("..").locator("span").last()
    ).toHaveText("1")
    expect(requests).toBe(1)
    await page.screenshot({path: testInfo.outputPath("fresh-graph-bootstrap.png")})
  })
}

for (const scope of ["custom", "disabled", "empty", "native"]) {
  test(`${scope} relay scope uses bundled graph without default graph traffic`, async ({
    page,
  }) => {
    const {sockets} = await configure(page, scope)
    let requests = 0
    await page.route(freshGraphBootstrap, (route) => {
      requests++
      return route.fulfill({status: 503, body: "Unexpected public bootstrap"})
    })
    await page.goto("/settings/social-graph")
    await expect(
      page.getByText("Distance 1", {exact: true}).locator("..").locator("span").last()
    ).toHaveText(String(manifest.directFollows))
    const graph = await exportedGraph(page)
    expect(graph.getFollowedByUser(manifest.root).size).toBe(manifest.directFollows)
    expect(requests).toBe(0)
    expect(sockets.some((url) => url.startsWith("wss://graph-relay.iris.to"))).toBe(false)
    expect(sockets.filter((url) => publicRelays.includes(url))).toEqual([])
    if (scope === "custom")
      await expect.poll(() => sockets.includes("wss://custom.test/")).toBe(true)
  })
}

test("changing relay settings aborts a pending public bootstrap and preserves personal lists", async ({
  page,
}) => {
  const {sockets, catchupRequests} = await configure(page)
  const personal = new SocialGraph(account)
  setList(personal, account, 3, [friend])
  setList(personal, account, 10000, [muted])
  await seedGraph(page, personal)
  const body = await fixtureGraph()
  let requested = false
  let aborted = false
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  page.on("requestfailed", (request) => {
    if (request.url().startsWith("https://graph-api.iris.to/social-graph/mobile"))
      aborted = true
  })
  await page.route(freshGraphBootstrap, async (route) => {
    requested = true
    await held
    await route
      .fulfill({
        body,
        contentType: "application/octet-stream",
        headers: {
          "x-graph-root": manifest.root,
          "access-control-expose-headers": "x-graph-root",
        },
      })
      .catch(() => {})
  })
  try {
    await page.goto("/settings/network")
    await expect.poll(() => requested).toBe(true)
    await page.getByTitle("Disconnect from relay", {exact: true}).first().uncheck()
    await expect.poll(() => aborted).toBe(true)
    release()
    await page.getByRole("link", {name: "Social Graph", exact: true}).first().click()
    await expect(
      page.getByText("Distance 1", {exact: true}).locator("..").locator("span").last()
    ).toHaveText(String(manifest.directFollows))
    const graph = await exportedGraph(page)
    expect(graph.getFollowedByUser(account)).toEqual(new Set([friend]))
    expect(graph.getMutedByUser(account)).toEqual(new Set([muted]))
    expect(graph.getFollowedByUser(manifest.root).has(discovered)).toBe(false)
    expect(sockets.some((url) => url.startsWith("wss://graph-relay.iris.to"))).toBe(false)
    expect(catchupRequests).toEqual([])
  } finally {
    release()
  }
})
