import {createServer} from "node:http"
import {expect, test} from "@playwright/test"

const usingBuiltDist = ["1", "true"].includes(
  process.env.IRIS_E2E_BUILT_DIST || process.env.IRIS_E2E_BUILT || ""
)

test("the wallet recovers an installed redirected cache through its parent view", async ({
  context,
  page,
  baseURL,
}) => {
  test.skip(!usingBuiltDist, "requires the production build")
  test.setTimeout(60000)
  let helperRequested = false
  let releaseHelper: (() => void) | undefined
  const helperHeld = new Promise<void>((resolve) => {
    releaseHelper = resolve
  })
  const oldWorker = `service-worker.${"1".repeat(64)}.js`
  // Reproduce the earlier worker's browser-visible defect using a real redirect,
  // real Cache storage and a real installed worker, with the current wallet bytes.
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://fixture.invalid")
    response.setHeader("Cache-Control", "no-store")
    if (url.pathname === "/cashu/index.html") {
      response.writeHead(302, {Location: `/cashu/${url.search}`})
      return response.end()
    }
    if (url.pathname === `/cashu/${oldWorker}`) {
      response.setHeader("Content-Type", "application/javascript")
      return response.end(`
        const name = 'legacy-cashu-static:' + self.registration.scope + ':' + '${"1".repeat(64)}';
        self.addEventListener('install', e => e.waitUntil(caches.open(name).then(c => c.add('/cashu/index.html'))));
        self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', e => {
          if (e.request.mode === 'navigate') e.respondWith(caches.open(name).then(c => c.match('/cashu/index.html')));
        });
      `)
    }
    if (url.pathname === "/fixture") {
      response.setHeader("Content-Type", "text/html")
      return response.end("<!doctype html><title>Wallet redirect fixture</title>")
    }
    if (url.pathname === "/cashu/offline.js") {
      helperRequested = true
      await helperHeld
    }
    try {
      const upstream = await fetch(new URL(url.pathname + url.search, baseURL))
      response.writeHead(upstream.status, {
        "Content-Type":
          upstream.headers.get("Content-Type") || "application/octet-stream",
      })
      response.end(Buffer.from(await upstream.arrayBuffer()))
    } catch {
      response.writeHead(502)
      response.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test port")
  const origin = `http://127.0.0.1:${address.port}`
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  )
  await context.routeWebSocket("**/*", (socket) => socket.close())
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  try {
    await page.goto(`${origin}/fixture`)
    const secret = "01".repeat(32)
    await page.evaluate(
      async ({oldWorker, secret}) => {
        localStorage.setItem("cashu.ndk.privateKeySignerPrivateKey", secret)
        localStorage.setItem("cashu.ndk.signerType", "PRIVATEKEY")
        localStorage.setItem("cashu.welcome.showWelcome", "false")
        localStorage.setItem("cashu.welcome.seedPhraseValidated", "true")
        localStorage.setItem("cashu.welcome.termsAccepted", "true")
        await navigator.serviceWorker.register(`/cashu/${oldWorker}`, {scope: "/cashu/"})
      },
      {oldWorker, secret}
    )
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await navigator.serviceWorker.getRegistration("/cashu/"))?.active?.state
        )
      )
      .toBe("activated")
    expect(
      await page.evaluate(
        async () => (await caches.match("/cashu/index.html"))?.redirected
      )
    ).toBe(true)
    const broken = await context.newPage()
    await expect(broken.goto(`${origin}/cashu/index.html`)).rejects.toThrow(/net::ERR_/)
    await broken.close()

    // No cache clearing, unregistering or forced worker activation: the actual
    // parent view installs the repair before creating the wallet frame.
    await page.goto(`${origin}/old-wallet`, {waitUntil: "domcontentloaded"})
    await expect.poll(() => helperRequested).toBe(true)
    // Even a slow helper must not mount a broken old wallet before the repair.
    await page.waitForTimeout(5500)
    await expect(page.locator('iframe[title="Legacy Cashu Wallet"]')).toHaveCount(0)
    releaseHelper!()
    // The replacement worker precaches the real wallet before activation. Wait
    // for that lifecycle event instead of spending the UI assertion's budget on
    // installation while concurrent release tests fetch the same assets.
    await page.evaluate(async (oldWorker) => {
      const registration = await navigator.serviceWorker.getRegistration("/cashu/")
      if (!registration) throw new Error("Wallet worker registration disappeared")
      await new Promise<void>((resolve, reject) => {
        const workers = new Set<ServiceWorker>()
        const cleanup = () => {
          registration.removeEventListener("updatefound", watch)
          for (const worker of workers) worker.removeEventListener("statechange", check)
        }
        const check = () => {
          if (registration.active && !registration.active.scriptURL.endsWith(oldWorker)) {
            cleanup()
            resolve()
          } else if ([...workers].some((worker) => worker.state === "redundant")) {
            cleanup()
            reject(new Error("Replacement wallet worker failed to install"))
          }
        }
        const watch = () => {
          const worker = registration.installing || registration.waiting
          if (worker && !workers.has(worker)) {
            workers.add(worker)
            worker.addEventListener("statechange", check)
          }
          check()
        }
        registration.addEventListener("updatefound", watch)
        watch()
      })
    }, oldWorker)
    const wallet = page.frameLocator('iframe[title="Legacy Cashu Wallet"]')
    await expect(wallet.locator("#q-app")).not.toBeEmpty()
    expect(
      await wallet
        .locator("#q-app")
        .evaluate(() => localStorage.getItem("cashu.ndk.privateKeySignerPrivateKey"))
    ).toBe(secret)
    expect(
      await page.evaluate(
        async () =>
          (await navigator.serviceWorker.getRegistration("/cashu/"))?.active?.scriptURL
      )
    ).not.toContain(oldWorker)
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
    await context.setOffline(true)
    await page.reload({waitUntil: "domcontentloaded"})
    await expect(wallet.locator("#q-app")).not.toBeEmpty()
    expect(errors).toEqual([])
  } finally {
    releaseHelper!()
    await context.setOffline(false)
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})
