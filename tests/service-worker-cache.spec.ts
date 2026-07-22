import {expect, test} from "@playwright/test"

const usingBuiltDist = ["1", "true"].includes(
  process.env.IRIS_E2E_BUILT_DIST || process.env.IRIS_E2E_BUILT || ""
)

test.describe("production service worker cache", () => {
  test.skip(!usingBuiltDist, "requires the production injectManifest build")

  test("preserves runtime caches, omits legacy Cashu, and serves Iris offline", async ({
    context,
    page,
  }) => {
    // Establish the app origin without loading index.html (and therefore without
    // registering the service worker) so this entry predates installation.
    await page.goto("/manifest.json")
    await page.evaluate(async () => {
      const cache = await caches.open("image-cache")
      await cache.put("/runtime-cache-sentinel", new Response("preserved"))
    })

    await page.goto("/")
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })

    const cacheState = await page.evaluate(async () => {
      const names = await caches.keys()
      const precacheNames = names.filter((name) => name.includes("precache"))
      const precachedUrls: string[] = []

      for (const name of precacheNames) {
        const cache = await caches.open(name)
        const requests = await cache.keys()
        precachedUrls.push(...requests.map((request) => new URL(request.url).pathname))
      }

      const runtimeCache = await caches.open("image-cache")
      const sentinel = await runtimeCache.match("/runtime-cache-sentinel")

      return {
        names,
        precachedUrls,
        sentinel: await sentinel?.text(),
      }
    })

    expect(cacheState.names).toContain("image-cache")
    expect(cacheState.sentinel).toBe("preserved")
    expect(cacheState.precachedUrls).toContain("/index.html")
    expect(cacheState.precachedUrls.some((url) => url.startsWith("/cashu/"))).toBe(false)

    await context.setOffline(true)
    await page.reload({waitUntil: "domcontentloaded"})
    await expect(page.locator("#root")).not.toBeEmpty()
  })
})
