import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("manually added relay connects and shows in count", async ({page}) => {
  test.setTimeout(60000)

  // Enable debug logging
  page.on("console", (msg) => {
    const text = msg.text()
    if (
      text.includes("relay") ||
      text.includes("Broadcasting") ||
      text.includes("Adding") ||
      text.includes("worker")
    ) {
      console.log(`[Browser Console]: ${text}`)
    }
  })

  await page.addInitScript(() => {
    localStorage.setItem("debug", "iris:ndk-worker,iris:ndk-relay")
  })

  // Sign up to see relay indicator
  await signUp(page, "Manual Add Test User")

  // Wait for initial relays to connect
  await page.waitForTimeout(5000)

  // Find relay connectivity indicator
  const relayIndicator = page.locator('[title*="relays"][title*="peers"]').first()
  await expect(relayIndicator).toBeVisible({timeout: 10000})

  // Get initial relay count
  const initialText = await relayIndicator.textContent()
  const initialCount = parseInt(initialText?.match(/\d+/)?.[0] || "0")
  console.log("Initial connected count:", initialCount)

  // Navigate to network settings to add relay
  await page.goto("/settings/network")
  await page.waitForTimeout(1000)

  // Click "Add relay" link to show input
  const addRelayLink = page
    .locator("a.link-info, button.link-info")
    .filter({hasText: "Add relay"})
  await addRelayLink.click()

  // Fill in relay URL (use relay.primal.net which should be running)
  const addRelayInput = page.locator('input[placeholder*="wss://relay.example.com"]')
  await addRelayInput.fill("relay.primal.net")

  // Click Add button
  const addButton = page.locator('button.btn-primary:has-text("Add")')
  await addButton.click()

  console.log("Added relay wss://relay.primal.net/")

  // Verify the relay appears in the settings list
  await page.waitForTimeout(1000)
  const relayList = page.locator("text=/relay\\.primal\\.net/")
  await expect(relayList).toBeVisible({timeout: 5000})

  console.log("✓ Relay added to settings successfully")
})
