import {expect, test} from "@playwright/test"
import {generateSecretKey, nip19, verifyEvent} from "nostr-tools"
import {FakeCashuMint} from "../src/lib/cashu/core/test/FakeCashuMint"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

test.use({serviceWorkers: "block"})

for (const failure of ["none", "mint", "provider"]) {
  test(`npub.cash imports paginated payments exactly once (${failure})`, async ({
    page,
    context,
  }, testInfo) => {
    const mint = await FakeCashuMint.start({inputFeePpk: 0})
    const relay = await startNostrRelay({port: 0})
    const mintUrl = "https://mint.npubcash.test"
    let unavailable = failure === "mint"
    let providerUnavailable = failure === "provider"
    const offsets: number[] = []
    try {
      const quotes = await Promise.all(
        [16, 8].map(async (amount) => {
          const response = await fetch(`${mint.url}/v1/mint/quote/bolt11`, {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({amount, unit: "sat"}),
          })
          const quote = await response.json()
          return {
            mintUrl,
            quoteId: quote.quote,
            request: quote.request,
            amount,
            state: "PAID",
            locked: false,
            expiresAt: quote.expiry,
          }
        })
      )
      await context.route(`${mintUrl}/**`, async (route) => {
        if (unavailable) return route.abort("connectionrefused")
        const response = await route.fetch({
          url: route.request().url().replace(mintUrl, mint.url),
        })
        await route.fulfill({response})
      })
      await context.route("https://npub.cash/api/**", async (route) => {
        const url = new URL(route.request().url())
        const authorization = (await route.request().allHeaders()).authorization
        const event = JSON.parse(Buffer.from(authorization.slice(6), "base64").toString())
        expect(verifyEvent(event)).toBe(true)
        expect(event.tags).toContainEqual(["u", `${url.origin}${url.pathname}`])
        expect(event.tags).toContainEqual(["method", "GET"])
        if (url.pathname === "/api/v2/wallet/quotes" && !providerUnavailable) {
          const offset = Number(url.searchParams.get("offset"))
          offsets.push(offset)
          return route.fulfill({
            json: {
              error: false,
              data: {quotes: quotes.slice(offset, offset + 1)},
              metadata: {total: 2, limit: 1},
            },
          })
        }
        // Reproduce the retired v1 endpoint's misleading HTTP 200 HTML response.
        return route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><html>npub.cash</html>",
        })
      })
      await context.addInitScript((port) => {
        window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
        localStorage.setItem(
          "settings-storage",
          JSON.stringify({
            version: 0,
            state: {legal: {tosAccepted: true, tosAcceptedVersion: 1}},
          })
        )
      }, relay.port)
      await signUp(page, nip19.nsecEncode(generateSecretKey()))
      const otherTab = failure === "none" ? await context.newPage() : undefined
      await Promise.all([page.goto("/wallet"), otherTab?.goto("/wallet")])
      if (failure !== "none") {
        const expectedStatus =
          failure === "mint" ? "24 sats awaiting receipt" : "Could not check npub.cash"
        await expect(
          page.getByRole("status").filter({hasText: expectedStatus})
        ).toBeVisible({timeout: 20000})
        await expect(page.getByText("0 bit", {exact: true})).toBeVisible()
        if (failure === "mint") {
          await page.screenshot({path: testInfo.outputPath("pending-payments.png")})
        }
        unavailable = false
        providerUnavailable = false
        await page.getByRole("button", {name: "Refresh", exact: true}).click()
      }
      await expect(page.getByText("24 bit", {exact: true})).toBeVisible({timeout: 20000})
      if (otherTab) {
        await otherTab.getByRole("button", {name: "Refresh", exact: true}).click()
        await expect(otherTab.getByText("24 bit", {exact: true})).toBeVisible()
        await otherTab.close()
      }
      expect(offsets).toContain(0)
      expect(offsets).toContain(1)
      expect(mint.mintRequests).toBe(2)
      // The provider can still report PAID after another wallet has issued ecash.
      // Local quote records must survive reload and prevent another credit.
      await page.reload()
      await page.getByRole("button", {name: "Refresh", exact: true}).click()
      await expect(page.getByText("24 bit", {exact: true})).toBeVisible()
      expect(mint.mintRequests).toBe(2)
    } finally {
      await relay.close()
      await mint.stop()
    }
  })
}
