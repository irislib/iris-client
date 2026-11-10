import {test, expect} from "./fixtures/isolatedBrowser"
import {SocialGraph} from "nostr-social-graph"
import {finalizeEvent, getPublicKey, nip19, type Filter} from "nostr-tools"
import {matchFilters} from "nostr-tools/filter"
import manifest from "../src/assets/socialGraph.json" with {type: "json"}
import {usingBuiltDist} from "./utils/built-dist"
import {freshGraphBootstrap} from "./utils/graph-bootstrap"
import {loopbackWorkerRelays, type FixtureSocket} from "./utils/worker-relay-loopback"

test("anonymous Popular loads posts from the default social graph", async ({
  page,
}, testInfo) => {
  test.skip(!usingBuiltDist, "requires the production graph bootstrap and worker bundle")
  const authorKey = new Uint8Array(32).fill(31)
  const reactorKey = new Uint8Array(32).fill(32)
  const author = getPublicKey(authorKey)
  const reactor = getPublicKey(reactorKey)
  const created_at = Math.floor(Date.now() / 1000) - 10
  const post = finalizeEvent(
    {
      kind: 1,
      created_at,
      tags: [],
      content: "A local popular post selected by the default graph.",
    },
    authorKey
  )
  const reaction = finalizeEvent(
    {
      kind: 7,
      created_at: created_at + 1,
      content: "+",
      tags: [
        ["e", post.id],
        ["p", author],
      ],
    },
    reactorKey
  )
  const events = [
    post,
    reaction,
    finalizeEvent(
      {
        kind: 0,
        created_at,
        tags: [],
        content: JSON.stringify({name: "Popular fixture author"}),
      },
      authorKey
    ),
  ]
  const graph = new SocialGraph(manifest.root)
  graph.handleEvent(
    {
      kind: 3,
      pubkey: manifest.root,
      created_at,
      tags: [
        ["p", author],
        ["p", reactor],
      ],
      content: "",
      id: "",
      sig: "",
    },
    true,
    Infinity
  )
  const body = Buffer.from(await graph.toBinary())
  let bootstrapRequests = 0
  await page.route(freshGraphBootstrap, (route) => {
    bootstrapRequests++
    return route.fulfill({
      body,
      contentType: "application/octet-stream",
      headers: {
        "x-graph-root": manifest.root,
        "access-control-expose-headers": "x-graph-root",
      },
    })
  })
  const workerRequests: Filter[] = []
  const serve = (socket: FixtureSocket) => {
    socket.onMessage((raw) => {
      const frame = raw.toString()
      if (!frame.startsWith("[")) return
      const [type, id, ...filters] = JSON.parse(frame)
      if (type === "REQ") {
        if (socket.worker) workerRequests.push(...filters)
        for (const event of events)
          if (matchFilters(filters, event))
            socket.send(JSON.stringify(["EVENT", id, event]))
        socket.send(JSON.stringify(["EOSE", id]))
      } else if (type === "NEG-OPEN") {
        socket.send(
          JSON.stringify(["NEG-ERR", id, "unsupported: fixture uses ordinary reads"])
        )
      } else if (type === "EVENT") {
        socket.send(JSON.stringify(["OK", id.id, true, ""]))
      }
    })
  }
  await page.context().routeWebSocket(/^(?:wss?:\/\/)/, serve)
  const close = await loopbackWorkerRelays(page, serve)
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        value: sessionStorage.getItem("copyOnly")
          ? undefined
          : async ({url}: ShareData) => {
              document.body.dataset.shared = url
            },
      })
    })
    await page.goto("/")
    await expect(page.locator("#main-content")).toBeVisible({timeout: 10000})
    const popularWidget = page.getByRole("heading", {name: "Popular"}).locator("..")
    await expect(popularWidget.getByText(post.content, {exact: true})).toBeVisible({
      timeout: 15000,
    })
    await expect(
      popularWidget.getByText("No popular posts found", {exact: true})
    ).toHaveCount(0)
    expect(bootstrapRequests).toBe(1)
    expect(
      workerRequests.some(
        (filter) => filter.kinds?.includes(7) && filter.authors?.includes(reactor)
      )
    ).toBe(true)
    expect(workerRequests.some((filter) => filter.ids?.includes(post.id))).toBe(true)
    const publicKey = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("user-storage") || "{}").state?.publicKey || ""
    )
    expect(publicKey).toBe("")
    await page.screenshot({path: testInfo.outputPath("anonymous-popular.png")})
    const share = page.getByRole("button", {name: "Share", exact: true}).first()
    const url = "https://iris.to/" + nip19.noteEncode(post.id)
    await share.click()
    const choices = page.getByRole("group", {name: "Share post"})
    await expect(choices.getByRole("button", {name: "Copy link"})).toBeFocused()
    await expect(page.locator("body")).not.toHaveAttribute("data-shared", url)
    await page.screenshot({path: testInfo.outputPath("post-share.png")})
    await choices.getByRole("button", {name: "Share via…"}).click()
    await expect(page.locator("body")).toHaveAttribute("data-shared", url)
    await page.evaluate(() => sessionStorage.setItem("copyOnly", "1"))
    await page.reload()
    await expect(page.getByText(post.content, {exact: true}).first()).toBeVisible()
    await page
      .context()
      .grantPermissions(["local-network-access", "clipboard-read", "clipboard-write"], {
        origin: new URL(page.url()).origin,
      })
    await share.click()
    await expect(page.getByText("Link copied", {exact: true}).first()).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url)
  } finally {
    await close()
  }
})
