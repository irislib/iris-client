import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"
// Same real FIPS seed fixture used by Iris Social; no file or event storage in the seed.
import {
  startLocalFipsWebSocketSeed,
  type LocalFipsWebSocketSeed,
} from "./fixtures/localFipsWebSocketSeed"

test.setTimeout(90000)
test.skip(usingBuiltDist, "the peer harness imports app modules from the source server")
let seed: LocalFipsWebSocketSeed
test.beforeAll(async () => {
  seed = await startLocalFipsWebSocketSeed()
})
test.afterAll(async () => {
  await seed?.close()
})

async function client(browser: Browser): Promise<{context: BrowserContext; page: Page}> {
  const context = await browser.newContext()
  await context.addInitScript((seedUrl) => {
    window.__IRIS_FIPS_TEST_CONFIG__ = {relays: ["ws://127.0.0.1:7777"], seeds: [seedUrl]}
    window.__HTREE_SERVER_URL__ = "http://127.0.0.1:7777"
  }, seed.url)
  // A remote file service cannot accidentally satisfy the test.
  await context.route("https://**/*", (route) => route.abort())
  const page = await context.newPage()
  await signUp(page, "Peer file test")
  return {context, page}
}
async function peers(page: Page) {
  return page
    .evaluate(async () => {
      const {getPeerRuntime} = await import("/src/lib/peerRuntime.ts")
      return (await getPeerRuntime())?.provider.listPeerIds() ?? []
    })
    .catch(() => [])
}
async function download(page: Page, nhash: string) {
  return page.evaluate(async (nhash) => {
    const {downloadFile} = await import("/src/lib/hashtree.ts")
    return Array.from(await downloadFile(nhash))
  }, nhash)
}

test("cached encrypted attachment is served across real browser peers without file servers", async ({
  browser,
}) => {
  const first = await client(browser)
  const second = await client(browser)
  try {
    await expect
      .poll(async () => (await peers(first.page)).length, {timeout: 30000})
      .toBeGreaterThan(0)
    await expect
      .poll(async () => (await peers(second.page)).length, {timeout: 30000})
      .toBeGreaterThan(0)
    const bytes = Array.from({length: 32000}, (_, i) => (i * 31 + 17) % 256)
    const nhash = await first.page.evaluate(async (bytes) => {
      const {uploadFile} = await import("/src/lib/hashtree.ts")
      return (await uploadFile(new File([new Uint8Array(bytes)], "peer-photo.bin"))).nhash
    }, bytes)
    expect(await download(second.page, nhash)).toEqual(bytes)
    // Cached encrypted chunks survive app/worker restart.
    await second.page.reload()
    expect(await download(second.page, nhash)).toEqual(bytes)
    await first.context.close()
    // A fresh browser must now obtain the downloaded copy from the second client.
    const third = await client(browser)
    try {
      await expect
        .poll(async () => (await peers(third.page)).length, {timeout: 30000})
        .toBeGreaterThan(0)
      expect(await download(third.page, nhash)).toEqual(bytes)
    } finally {
      await third.context.close()
    }
  } finally {
    await first.context.close()
    await second.context.close()
  }
})

test("a reloaded client serves retained notes over the same peer network", async ({
  browser,
}) => {
  const first = await client(browser)
  const second = await client(browser)
  try {
    // Relay acknowledges public posts but never stores or forwards them.
    // Discovery and all other real app interests keep using the local relay.
    await first.context.routeWebSocket("ws://127.0.0.1:7777", (socket) => {
      const server = socket.connectToServer()
      socket.onMessage((message) => {
        try {
          const frame = JSON.parse(String(message))
          if (frame[0] === "EVENT" && frame[1]?.kind === 1) {
            socket.send(JSON.stringify(["OK", frame[1].id, true, ""]))
            return
          }
        } catch {
          // Forward non-Nostr frames unchanged.
        }
        server.send(message)
      })
    })
    await first.page.reload()
    await expect
      .poll(async () => (await peers(first.page)).length, {timeout: 30000})
      .toBeGreaterThan(0)
    const content = `A note available only through a peer ${Date.now()}`
    await first.page.locator("#main-content").getByTestId("new-post-button").click()
    const dialog = first.page.getByRole("dialog")
    await dialog.getByPlaceholder("What's on your mind?").fill(content)
    await dialog.getByRole("button", {name: "Post", exact: true}).click()
    await first.page.waitForURL(/\/note[a-z0-9]+/)
    const pathname = new URL(first.page.url()).pathname
    await first.page.reload()
    await second.page.goto(pathname)
    await expect(second.page.getByText(content, {exact: true}).first()).toBeVisible({
      timeout: 30000,
    })
  } finally {
    await first.context.close()
    await second.context.close()
  }
})
