import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

async function setupChatWithSelf(page, username) {
  // Go to chats
  await page.getByRole("link", {name: "Chats"}).click()
  await page.waitForLoadState("networkidle")

  // Wait for the New Chat header to be visible
  await expect(page.locator("header").getByText("New Chat")).toBeVisible({timeout: 10000})

  // We're already on the new chat page at /chats
  // No need to click any link since /chats now shows NewChat by default

  // Search for self by username
  const searchInput = page.getByPlaceholder("Search for users")
  await expect(searchInput).toBeVisible()
  await searchInput.fill(username)
  await page.waitForTimeout(1000)

  // Wait for the self user result button to be visible and click it
  const selfButton = page.locator(`button[aria-label="${username}"]`).first()
  try {
    await expect(selfButton).toBeVisible({timeout: 5000})
  } catch (e) {
    const allLabels = await page.locator("button[aria-label]").allTextContents()
    console.error("User result buttons found:", allLabels)
    throw e
  }
  await selfButton.click()

  // Wait for navigation to chat view
  await expect(page).toHaveURL(/\/chats\/chat/, {timeout: 10000})
}

test.describe.skip("Message persistence with double ratchet", () => {
  test("messages persist after page refresh", async ({page}) => {
    const username = await signUp(page)
    await setupChatWithSelf(page, username)

    // Send a message
    const messageInput = page.getByPlaceholder("Message")
    const testMessage = "Message before refresh"
    await messageInput.fill(testMessage)
    await messageInput.press("Enter")

    // Verify message appears
    await expect(
      page.locator(".whitespace-pre-wrap").getByText(testMessage)
    ).toBeVisible()

    // Refresh the page
    await page.reload()
    await page.waitForLoadState("networkidle")

    // Verify message still appears
    await expect(page.locator(".whitespace-pre-wrap").getByText(testMessage)).toBeVisible(
      {timeout: 10000}
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
    ).toBeVisible()
  })

  test("can continue conversation after refresh", async ({page}) => {
    const username = await signUp(page)
    await setupChatWithSelf(page, username)

    // Send initial messages
    const messageInput = page.getByPlaceholder("Message")
    const messages = ["First message", "Second message", "Third message"]

    for (const msg of messages) {
      await messageInput.fill(msg)
      await messageInput.press("Enter")
      await expect(page.locator(".whitespace-pre-wrap").getByText(msg)).toBeVisible()
    }

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
      await expect(page.locator(".whitespace-pre-wrap").getByText(msg)).toBeVisible()
    }

    // Verify all messages (before and after refresh) are visible
    const allMessages = [...messages, ...continuedMessages]
    for (const msg of allMessages) {
      await expect(page.locator(".whitespace-pre-wrap").getByText(msg)).toBeVisible()
    }
  })

  test("session state persists across multiple refreshes", async ({page}) => {
    const username = await signUp(page)
    await setupChatWithSelf(page, username)

    // Send initial message
    const messageInput = page.getByPlaceholder("Message")
    await messageInput.fill("Initial message")
    await messageInput.press("Enter")

    // Wait for initial message to appear
    await expect(
      page.locator(".whitespace-pre-wrap").getByText("Initial message")
    ).toBeVisible()

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

      await expect(page.locator(".whitespace-pre-wrap").getByText(msg)).toBeVisible()
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
