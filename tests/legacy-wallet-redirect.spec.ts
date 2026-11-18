import {createServer} from "node:http"
import {expect, test, type BrowserContext, type Page} from "@playwright/test"
import clientWorker from "../scripts/well-known-proxy-worker.mjs"

const usingBuiltDist = ["1", "true"].includes(
  process.env.IRIS_E2E_BUILT_DIST || process.env.IRIS_E2E_BUILT || ""
)

test("the wallet recovers an installed redirected cache through its parent view", async ({
  context,
  page,
  baseURL,
}) => {
  await checkLegacyWalletRecovery(context, page, baseURL, "")
})

test("same-origin recovery keeps the existing wallet and isolates the Client worker scope", async ({
  context,
  page,
  baseURL,
}) => {
  await checkLegacyWalletRecovery(context, page, baseURL, "/old")
})

async function checkLegacyWalletRecovery(
  context: BrowserContext,
  page: Page,
  baseURL: string | undefined,
  mount: string
) {
  test.skip(!usingBuiltDist, "requires the production build")
  test.setTimeout(60000)
  let helperRequested = false
  let rootWorker: "previous" | "client" | "transition" = "previous"
  let releaseHelper: (() => void) | undefined
  const helperHeld = new Promise<void>((resolve) => {
    releaseHelper = resolve
  })
  const oldWorker = `service-worker.${"1".repeat(64)}.js`
  // Reproduce the earlier worker's browser-visible defect using a real redirect,
  // real Cache storage and a real installed worker, with the current wallet bytes.
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, `http://${request.headers.host}`)
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
    if (mount && rootWorker === "previous" && url.pathname === "/service-worker.js") {
      response.setHeader("Content-Type", "application/javascript")
      return response.end(`
        self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
        self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', e => {
          if (e.request.mode === 'navigate' && ['/fixture', '/old'].includes(new URL(e.request.url).pathname)) {
            e.respondWith(new Response('<title>Previous root worker</title>', {headers: {'Content-Type': 'text/html'}}));
          }
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
      const fetchAsset = (assetRequest: Request) => {
        const asset = new URL(assetRequest.url)
        // Simulate Assets canonicalizing a request for index.html outside the mount.
        if (
          url.pathname === `${mount}/index.html` &&
          mount &&
          asset.pathname === "/index.html"
        ) {
          return Response.redirect(new URL("/", url), 308)
        }
        return fetch(new URL(asset.pathname + asset.search, baseURL), {
          method: assetRequest.method,
        })
      }
      if (rootWorker === "transition" && url.pathname === "/service-worker.js") {
        url.pathname = "/legacy-apex-service-worker.js"
      }
      const workerRequest = new Request(url, {
        method: request.method,
        headers: {"x-forwarded-proto": "https"},
      })
      const upstream = mount
        ? await clientWorker.fetch(workerRequest, {ASSETS: {fetch: fetchAsset}})
        : await fetchAsset(workerRequest)
      const headers: Record<string, string> = {
        "Content-Type":
          upstream.headers.get("Content-Type") || "application/octet-stream",
      }
      const location = upstream.headers.get("Location")
      if (location) headers.Location = location
      response.writeHead(upstream.status, headers)
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
    if (mount) {
      const redirect = await context.request.get(`${origin}${mount}?ref=cold`, {
        maxRedirects: 0,
      })
      expect(redirect.status()).toBe(308)
      expect(redirect.headers().location).toBe(`${origin}${mount}/?ref=cold`)
    }
    const recoveryUrl = `${origin}${mount}/old-wallet`
    await page.goto(recoveryUrl, {waitUntil: "domcontentloaded"})
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
    expect(
      await page.evaluate(() => navigator.serviceWorker.ready.then((reg) => reg.scope))
    ).toBe(`${origin}${mount}/`)
    if (mount) {
      await expect(page.locator('link[rel="manifest"]')).toHaveCount(0)
      expect(
        await page.evaluate(async () =>
          Boolean(await navigator.serviceWorker.getRegistration("/"))
        )
      ).toBe(false)
      const home = page.locator(`a[href="${mount}/"]`).first()
      await expect(home).toBeVisible()
      await home.click()
      await expect(page).toHaveURL(`${origin}${mount}/`)
      await page.goBack()
      await expect(page).toHaveURL(recoveryUrl)
      await expect(wallet.locator("#q-app")).not.toBeEmpty()
      await expect(
        wallet.locator("#q-app").evaluate(() => location.pathname)
      ).resolves.toMatch(/^\/cashu\//)
    }
    await context.setOffline(true)
    await page.reload({waitUntil: "domcontentloaded"})
    await expect(wallet.locator("#q-app")).not.toBeEmpty()

    if (mount) {
      await page.screenshot({path: test.info().outputPath("legacy-recovery.png")})
      await context.setOffline(false)
      await page.evaluate(() => navigator.serviceWorker.register("/service-worker.js"))
      await expect
        .poll(() =>
          page.evaluate(
            async () =>
              (await navigator.serviceWorker.getRegistration("/"))?.active?.state
          )
        )
        .toBe("activated")
      const landing = await context.newPage()
      await landing.goto(`${origin}/fixture`)
      await expect(landing).toHaveTitle("Previous root worker")
      const mountUrl = `${origin}${mount}?ref=returning`
      await landing.goto(mountUrl)
      await expect(landing).toHaveTitle("Previous root worker")
      rootWorker = "client"
      await landing.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/")
        if (!registration) throw new Error("Missing warmed root worker")
        await registration.update()
        const activate = () => registration.waiting?.postMessage({type: "SKIP_WAITING"})
        registration.installing?.addEventListener("statechange", activate)
        activate()
      })
      await expect
        .poll(async () => {
          await landing.goto(mountUrl, {waitUntil: "domcontentloaded"})
          return landing.url()
        })
        .toBe(`${origin}${mount}/?ref=returning`)
      await expect(landing.locator("#main-content")).toBeVisible()
      await expect(landing.locator('link[rel="manifest"]')).toHaveCount(0)
      await landing.goto(`${origin}/`)
      await expect(landing.locator('link[rel="manifest"]')).toHaveCount(1)

      rootWorker = "transition"
      await landing.evaluate(async () => {
        await (await navigator.serviceWorker.getRegistration("/"))?.update()
      })
      await expect
        .poll(async () => {
          await landing.goto(`${origin}/fixture`, {waitUntil: "domcontentloaded"})
          return landing.title()
        })
        .toBe("Wallet redirect fixture")
      await expect(wallet.locator("#q-app")).not.toBeEmpty()
      expect(
        await page.evaluate(
          async () =>
            (await navigator.serviceWorker.getRegistration("/cashu/"))?.active?.state
        )
      ).toBe("activated")
      await landing.close()

      await page.goto(`${origin}${mount}/wallet?paymentRequest=lncanary&ref=recovery`)
      await expect(page).toHaveURL(`${origin}${mount}/wallet?ref=recovery`)
    }
    expect(errors).toEqual([])
  } finally {
    releaseHelper!()
    await context.setOffline(false)
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
}
