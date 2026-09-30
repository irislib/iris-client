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

test("direct and embedded legacy wallets retain saved funds on an offline full reload", async ({
  context,
  page,
}) => {
  test.skip(!usingBuiltDist, "requires the production injectManifest build")
  test.setTimeout(60000)
  await page.goto("/manifest.json")
  const saved = await page.evaluate(async () => {
    const state = {
      "cashu.mnemonic":
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      "cashu.ndk.signerType": "PRIVATEKEY",
      "cashu.ndk.privateKeySignerPrivateKey": "01".repeat(32),
      "cashu.nwc.enabled": "false",
      "cashu.npc.enabled": "false",
      "cashu.pr.enable": "false",
      "cashu.settings.getBitcoinPrice": "false",
      "cashu.settings.checkInvoicesOnStartup": "false",
      "cashu.settings.checkSentTokens": "false",
      "cashu.settings.checkIncomingInvoices": "false",
      "cashu.settings.periodicallyCheckIncomingInvoices": "false",
      "cashu.welcome.showWelcome": "false",
      "cashu.welcome.seedPhraseValidated": "true",
      "cashu.welcome.termsAccepted": "true",
      "cashu.dexie.migrated": "true",
      "cashu.keysetCounters": JSON.stringify([{id: "009a1f293253e41e", counter: 17}]),
      "cashu.historyTokens": JSON.stringify([
        {token: "synthetic-retained-token", amount: 8, status: "pending"},
      ]),
      "cashu.lastLocalStorageCleanUp": new Date().toISOString(),
    }
    for (const [key, value] of Object.entries(state)) localStorage.setItem(key, value)
    const proof = {
      id: "009a1f293253e41e",
      amount: 8,
      secret: "synthetic-offline-proof",
      C: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      reserved: true,
      quote: "synthetic-quote",
    }
    const open = indexedDB.open("db", 1)
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore("proofs", {keyPath: "secret"})
      for (const key of ["id", "C", "amount", "reserved", "quote"])
        store.createIndex(key, key)
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const tx = db.transaction("proofs", "readwrite")
    tx.objectStore("proofs").put(proof)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    const retained = Object.fromEntries(
      Object.entries(state).filter(([key]) => key !== "cashu.lastLocalStorageCleanUp")
    )
    return {state: retained, proof}
  })

  // A first direct visit installs the wallet worker without updating the root Client worker.
  await page.goto("/cashu/index.html")
  await expect(page.locator("#q-app")).not.toBeEmpty()
  await page.waitForFunction(() =>
    navigator.serviceWorker.controller?.scriptURL.includes("/cashu/service-worker.")
  )
  const cachedPaths = await page.evaluate(async () =>
    (
      await (
        await caches.open(
          (await caches.keys()).find((name) =>
            name.startsWith(`legacy-cashu-static:${location.origin}/cashu/:`)
          )!
        )
      ).keys()
    ).map((request) => new URL(request.url).pathname)
  )
  expect(cachedPaths).toContain("/cashu/index.html")
  expect(cachedPaths.every((url) => url.startsWith("/cashu/"))).toBe(true)
  await page.evaluate(() =>
    fetch("/cashu/api/v1/balance?synthetic=1").catch(() => undefined)
  )
  expect(
    await page.evaluate(async () =>
      Boolean(await caches.match("/cashu/api/v1/balance?synthetic=1"))
    )
  ).toBe(false)

  await page.goto("/old-wallet")
  await expect(
    page.frameLocator('iframe[title="Legacy Cashu Wallet"]').locator("#q-app")
  ).not.toBeEmpty()
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await context.setOffline(true)
  await page.goto("/cashu/", {waitUntil: "domcontentloaded"})
  await expect(page.locator("#q-app")).not.toBeEmpty()
  await page.reload({waitUntil: "domcontentloaded"})
  await expect(page.locator("#q-app")).not.toBeEmpty()
  for (const [route, text] of [
    ["settings", "Backup seed phrase"],
    ["restore", "Restore from Seed Phrase"],
    ["terms", "Read Terms of Service"],
  ]) {
    await page.goto(`/cashu/${route}?offline=1#retained`, {
      waitUntil: "domcontentloaded",
    })
    await expect(page.getByText(text, {exact: true})).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/cashu/${route}\\?offline=1#retained$`))
    await page.reload({waitUntil: "domcontentloaded"})
    await expect(page.getByText(text, {exact: true})).toBeVisible()
  }
  await page.goto("/old-wallet", {waitUntil: "domcontentloaded"})
  const wallet = page.frameLocator('iframe[title="Legacy Cashu Wallet"]')
  await expect(wallet.locator("#q-app")).not.toBeEmpty()
  await page.reload({waitUntil: "domcontentloaded"})
  await expect(wallet.locator("#q-app")).not.toBeEmpty()
  const restored = await wallet.locator("#q-app").evaluate(async (_, keys) => {
    const open = indexedDB.open("db")
    const db = await new Promise<IDBDatabase>((resolve) => {
      open.onsuccess = () => resolve(open.result)
    })
    const request = db.transaction("proofs").objectStore("proofs").getAll()
    const proofs = await new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result)
    })
    db.close()
    return {
      state: Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
      proofs,
    }
  }, Object.keys(saved.state))
  expect(restored).toEqual({state: saved.state, proofs: [saved.proof]})
})
