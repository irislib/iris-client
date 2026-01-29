import {test, expect} from "@playwright/test"
import {signUp, signIn} from "./auth.setup"

async function waitForConnectedRelays(page) {
  const relayIndicator = page.locator('[title*="relays connected"]').first()
  await expect(relayIndicator).toBeVisible({timeout: 10000})
  await expect
    .poll(
      async () => {
        const text = await relayIndicator.textContent()
        return parseInt(text?.match(/\d+/)?.[0] || "0", 10)
      },
      {timeout: 10000}
    )
    .toBeGreaterThan(0)
}

test.describe("Self-messaging between browser sessions", () => {
  test("should sync messages between two sessions with same key", async ({browser}) => {
    test.setTimeout(60000) // 60 second timeout for the complex multi-session test

    // Create two browser contexts (sessions)
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    try {
      // Sign up on page1 to get a unique private key
      const {privateKey} = await signUp(page1)
      if (!privateKey) {
        throw new Error("Could not get private key from signup")
      }

      // Sign in on page2 with the same key
      await signIn(page2, privateKey)

      await waitForConnectedRelays(page1)
      await waitForConnectedRelays(page2)

      const timestamp = Date.now()
      const testMessage1 = `Test message 1: ${timestamp}`
      const testMessage2 = `Test message 2: ${timestamp}`

      // Page 1: Go to own profile and start chat
      const profileLink1 = page1.locator('[data-testid="sidebar-user-row"]').first()
      await profileLink1.click()
      await page1.waitForLoadState("networkidle")

      // Wait for profile to load
      await expect(page1.getByTestId("profile-header-actions")).toBeVisible({
        timeout: 10000,
      })

      // Click the mail/message button
      const messageButton1 = page1
        .getByTestId("profile-header-actions")
        .locator("button.btn-circle")
        .first()
      await expect(messageButton1).toBeVisible({timeout: 5000})
      await messageButton1.click()

      // Wait for chat to load
      await expect(page1.getByPlaceholder("Message")).toBeVisible({timeout: 15000})

      // Send first message from page1
      const messageInput1 = page1.getByPlaceholder("Message")
      await messageInput1.fill(testMessage1)
      await messageInput1.press("Enter")

      // Verify message appears on page1
      await expect(
        page1.locator(".whitespace-pre-wrap").getByText(testMessage1)
      ).toBeVisible({timeout: 10000})

      // Page 2: Go to own profile and start chat
      // Do this AFTER page1 sends the message so page2's subscription can fetch it
      const profileLink2 = page2.locator('[data-testid="sidebar-user-row"]').first()
      await profileLink2.click()
      await page2.waitForLoadState("networkidle")

      await expect(page2.getByTestId("profile-header-actions")).toBeVisible({
        timeout: 10000,
      })

      const messageButton2 = page2
        .getByTestId("profile-header-actions")
        .locator("button.btn-circle")
        .first()
      await expect(messageButton2).toBeVisible({timeout: 5000})
      await messageButton2.click()

      // Wait for chat to load and subscription to fetch messages
      await expect(page2.getByPlaceholder("Message")).toBeVisible({timeout: 15000})

      // Verify message from page1 appears on page2
      // The chat should fetch historical messages when opened
      await expect(
        page2.locator(".whitespace-pre-wrap").getByText(testMessage1)
      ).toBeVisible({timeout: 10000})

      // Send second message from page2
      const messageInput2 = page2.getByPlaceholder("Message")
      await messageInput2.fill(testMessage2)
      await messageInput2.press("Enter")

      // Verify message appears on page2
      await expect(
        page2.locator(".whitespace-pre-wrap").getByText(testMessage2)
      ).toBeVisible({timeout: 10000})

      // Verify message from page2 appears on page1
      // May need to refresh page1 or wait for subscription to pick it up
      await expect(
        page1.locator(".whitespace-pre-wrap").getByText(testMessage2)
      ).toBeVisible({timeout: 10000})
    } finally {
      await context1.close()
      await context2.close()
    }
  })
})
