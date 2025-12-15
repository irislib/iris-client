import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

async function setupChatWithSelf(page) {
  // Go to own profile via the sidebar user row
  const profileLink = page.locator('[data-testid="sidebar-user-row"]').first()
  await profileLink.click()
  await page.waitForLoadState("networkidle")

  // Wait for profile to load
  await expect(page.getByTestId("profile-header-actions")).toBeVisible({timeout: 10000})

  // Click the mail/message button (it's a circle button with mail-outline icon)
  const messageButton = page
    .getByTestId("profile-header-actions")
    .locator("button.btn-circle")
    .first()
  await expect(messageButton).toBeVisible({timeout: 5000})
  await messageButton.click()

  // Wait for the chat UI to load - look for the message input
  await expect(page.getByPlaceholder("Message")).toBeVisible({timeout: 15000})
}

test.describe("Message persistence with double ratchet", () => {
  test("messages persist after page refresh", async ({page}) => {
    await signUp(page)
    await setupChatWithSelf(page)

    // Send a message
    const messageInput = page.getByPlaceholder("Message")
    const testMessage = "Message before refresh"
    await messageInput.fill(testMessage)
    await messageInput.press("Enter")

    // Verify message appears
    await expect(page.locator(".whitespace-pre-wrap").getByText(testMessage)).toBeVisible(
      {timeout: 10000}
    )

    // Wait for message to persist
    await page.waitForTimeout(1000)

    // Refresh the page
    await page.reload()
    await page.waitForLoadState("networkidle")

    // Verify message still appears
    await expect(page.locator(".whitespace-pre-wrap").getByText(testMessage)).toBeVisible(
      {
        timeout: 10000,
      }
    )

    // Send another message after refresh
    const messageAfterRefresh = "Message after refresh"
    await messageInput.fill(messageAfterRefresh)
    await messageInput.press("Enter")

    // Verify both messages appear
    await expect(
      page.locator(".whitespace-pre-wrap").getByText(testMessage)
    ).toBeVisible()
    await expect(
      page.locator(".whitespace-pre-wrap").getByText(messageAfterRefresh)
    ).toBeVisible({timeout: 10000})
  })

  test("can continue conversation after refresh", async ({page}) => {
    await signUp(page)
    await setupChatWithSelf(page)

    // Send initial messages
    const messageInput = page.getByPlaceholder("Message")
    const messages = ["First message", "Second message", "Third message"]

    for (const msg of messages) {
      await messageInput.fill(msg)
      await messageInput.press("Enter")
      await expect(page.locator(".whitespace-pre-wrap").getByText(msg)).toBeVisible({
        timeout: 10000,
      })
    }

    // Wait for messages to persist
    await page.waitForTimeout(1000)

    // Refresh the page
    await page.reload()
    await page.waitForLoadState("networkidle")

    // Verify all messages still appear
    for (const msg of messages) {
      await expect(page.locator(".whitespace-pre-wrap").getByText(msg)).toBeVisible({
        timeout: 10000,
      })
    }

    // Continue the conversation
    const continuedMessages = ["Message after refresh 1", "Message after refresh 2"]

    for (const msg of continuedMessages) {
      await messageInput.fill(msg)
      await messageInput.press("Enter")
      await expect(page.locator(".whitespace-pre-wrap").getByText(msg)).toBeVisible({
        timeout: 10000,
      })
    }

    // Verify all messages (before and after refresh) are visible
    const allMessages = [...messages, ...continuedMessages]
    for (const msg of allMessages) {
      await expect(page.locator(".whitespace-pre-wrap").getByText(msg)).toBeVisible()
    }
  })

  test("session state persists across multiple refreshes", async ({page}) => {
    await signUp(page)
    await setupChatWithSelf(page)

    // Send initial message
    const messageInput = page.getByPlaceholder("Message")
    await messageInput.fill("Initial message")
    await messageInput.press("Enter")

    // Wait for initial message to appear
    await expect(
      page.locator(".whitespace-pre-wrap").getByText("Initial message")
    ).toBeVisible({timeout: 10000})

    // Wait for message to persist
    await page.waitForTimeout(1000)

    // Do multiple refreshes
    for (let i = 1; i <= 3; i++) {
      await page.reload()
      await page.waitForLoadState("networkidle")

      // Wait for chat to load - check if initial message is visible
      await expect(
        page.locator(".whitespace-pre-wrap").getByText("Initial message")
      ).toBeVisible({timeout: 10000})

      // Send a message after each refresh
      const msg = `Message after refresh ${i}`
      await messageInput.fill(msg)
      await messageInput.press("Enter")

      await expect(page.locator(".whitespace-pre-wrap").getByText(msg)).toBeVisible({
        timeout: 10000,
      })

      // Wait for message to persist
      await page.waitForTimeout(500)
    }

    // Verify all messages are still visible
    await expect(
      page.locator(".whitespace-pre-wrap").getByText("Initial message")
    ).toBeVisible()

    for (let i = 1; i <= 3; i++) {
      await expect(
        page.locator(".whitespace-pre-wrap").getByText(`Message after refresh ${i}`)
      ).toBeVisible()
    }
  })
})
