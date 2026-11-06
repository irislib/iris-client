import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"
import {enableHeaderConnectivity} from "./ui-settings"
import {startNostrRelay} from "../dev-relay/nostr-relay"

test("relay status updates when going offline and back online", async ({
  page,
  context,
}) => {
  const relay = await startNostrRelay({port: 0})
  await page.addInitScript((port) => {
    window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
  }, relay.port)
  await enableHeaderConnectivity(page)
  try {
    await signUp(page, "Offline Test User")
    const indicator = page.getByTestId("connectivity-indicator").first()
    await expect(indicator).toBeVisible()
    await expect(indicator).toHaveAttribute("title", /\b[1-9]\d* relays? connected/, {
      timeout: 15000,
    })
    await context.setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event("offline")))
    await expect(indicator).toHaveAttribute("data-connection-state", "disconnected")
    await expect(indicator).toHaveAttribute("title", /\b0 relays connected/)
    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event("online")))
    await expect(indicator).toHaveAttribute("title", /\b[1-9]\d* relays? connected/, {
      timeout: 15000,
    })
    await expect(indicator).toHaveAttribute("data-connection-state", "servers")
    await expect(page.getByLabel("Offline", {exact: true})).not.toBeVisible()
  } finally {
    await context.setOffline(false)
    await page.close()
    await relay.close()
  }
})
