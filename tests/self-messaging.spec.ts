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

async function openSelfChat(page) {
  const profileLink = page.locator('[data-testid="sidebar-user-row"]').first()
  await profileLink.click()
  await page.waitForLoadState("domcontentloaded")

  await expect(page.getByTestId("profile-header-actions")).toBeVisible({
    timeout: 10000,
  })

  const messageButton = page
    .getByTestId("profile-header-actions")
    .locator("button")
    .filter({has: page.locator('use[href*="mail-outline"]')})
    .first()
  await expect(messageButton).toBeVisible({timeout: 15000})
  await messageButton.click()
  await expect(page).toHaveURL(/\/chats\/chat/, {timeout: 15000})

  const messageInput = page.getByPlaceholder("Message")
  await expect(messageInput).toBeVisible({timeout: 15000})
  await expect(messageInput).toBeEnabled({timeout: 20000})
}

test.describe("Self-messaging between browser sessions", () => {
  test("should sync messages between two sessions with same key", async ({browser}) => {
    test.setTimeout(120000) // Multi-session + relay propagation can be slow under parallel e2e load

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

      await openSelfChat(page1)

      // Send first message from page1
      const messageInput1 = page1.getByPlaceholder("Message")
      await messageInput1.fill(testMessage1)
      await messageInput1.press("Enter")

      // Verify message appears on page1
      await expect(
        page1.locator(".whitespace-pre-wrap").getByText(testMessage1)
      ).toBeVisible({timeout: 10000})

      // Page 2: Open self chat after page1 sends the message so page2's subscription can fetch it
      await openSelfChat(page2)

      // Verify message from page1 appears on page2
      // The chat should fetch historical messages when opened
      await expect(
        page2.locator(".whitespace-pre-wrap").getByText(testMessage1)
      ).toBeVisible({timeout: 60000})

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
      ).toBeVisible({timeout: 60000})
    } finally {
      await context1.close()
      await context2.close()
    }
  })

  test("should keep same-key chats accepted when both sessions are already open", async ({
    browser,
  }) => {
    test.setTimeout(120000)

    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    try {
      const {privateKey, publicKey} = await signUp(page1)
      if (!privateKey || !publicKey) {
        throw new Error("Could not get same-key credentials from signup")
      }

      await signIn(page2, privateKey)

      await waitForConnectedRelays(page1)
      await waitForConnectedRelays(page2)

      await openSelfChat(page1)
      await openSelfChat(page2)

      const testMessage = `Open self-chat message ${Date.now()}`

      const messageInput1 = page1.getByPlaceholder("Message")
      await messageInput1.fill(testMessage)
      await messageInput1.press("Enter")

      await expect(
        page1.locator(".whitespace-pre-wrap").getByText(testMessage)
      ).toBeVisible({timeout: 10000})

      await expect(
        page2.locator(".whitespace-pre-wrap").getByText(testMessage)
      ).toBeVisible({timeout: 60000})

      await expect(page2.getByTestId("message-request-actions")).not.toBeVisible({
        timeout: 5000,
      })
    } finally {
      await context1.close()
      await context2.close()
    }
  })

  test("should sync same-key messages across three open sessions", async ({browser}) => {
    test.setTimeout(180000)

    const context1 = await browser.newContext()
    const context2 = await browser.newContext()
    const context3 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()
    const page3 = await context3.newPage()

    try {
      const {privateKey} = await signUp(page1)
      if (!privateKey) {
        throw new Error("Could not get private key from signup")
      }

      await signIn(page2, privateKey)
      await signIn(page3, privateKey)

      await waitForConnectedRelays(page1)
      await waitForConnectedRelays(page2)
      await waitForConnectedRelays(page3)

      await openSelfChat(page1)
      await openSelfChat(page2)
      await openSelfChat(page3)

      const testMessage = `Three-session self message ${Date.now()}`
      const messageInput1 = page1.getByPlaceholder("Message")
      await messageInput1.fill(testMessage)
      await messageInput1.press("Enter")

      await expect(
        page1.locator(".whitespace-pre-wrap").getByText(testMessage)
      ).toBeVisible({timeout: 10000})
      await expect(
        page2.locator(".whitespace-pre-wrap").getByText(testMessage)
      ).toBeVisible({timeout: 60000})
      await expect(
        page3.locator(".whitespace-pre-wrap").getByText(testMessage)
      ).toBeVisible({timeout: 60000})

      await expect(page2.getByTestId("message-request-actions")).not.toBeVisible({
        timeout: 5000,
      })
      await expect(page3.getByTestId("message-request-actions")).not.toBeVisible({
        timeout: 5000,
      })
    } finally {
      await context1.close()
      await context2.close()
      await context3.close()
    }
  })
})
