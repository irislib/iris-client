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
  // The button should appear for own profile since myPubKey === pubKeyHex
  const messageButton = page
    .getByTestId("profile-header-actions")
    .locator("button.btn-circle")
    .first()
  await expect(messageButton).toBeVisible({timeout: 5000})
  await messageButton.click()

  // Wait for the chat UI to load - look for the message input
  await expect(page.getByPlaceholder("Message")).toBeVisible({timeout: 15000})
}

test.describe("Message Form - Desktop", () => {
  test("can send a basic text message using Enter key", async ({page}) => {
    await signUp(page)
    await setupChatWithSelf(page)

    const messageInput = page.getByPlaceholder("Message").first()
    const testMessage = "Hello, this is a test message!"
    await messageInput.fill(testMessage)
    await messageInput.press("Enter")

    // Look for the message in the chat area specifically
    await expect(
      page.locator(".whitespace-pre-wrap").getByText(testMessage)
    ).toBeVisible({timeout: 10000})

    await expect(page.getByRole("button", {name: "Send message"})).not.toBeVisible()
  })

  test("empty message cannot be sent", async ({page}) => {
    await signUp(page)
    await setupChatWithSelf(page)

    const messageInput = page.getByPlaceholder("Message").first()
    await messageInput.fill("   ") // Just spaces
    await messageInput.press("Enter")

    // Verify empty message doesn't appear in chat
    await expect(
      page.locator(".whitespace-pre-wrap").getByText("   ", {exact: true})
    ).not.toBeVisible()
  })

  test("shift + enter adds a new line", async ({page}) => {
    await signUp(page)
    await setupChatWithSelf(page)

    const messageInput = page.getByPlaceholder("Message").first()
    await messageInput.fill("Hello, this is a test message!")
    await messageInput.press("Shift+Enter")

    await expect(messageInput).toHaveValue("Hello, this is a test message!\n")
  })

  test("multiple shift + enter presses add multiple new lines", async ({page}) => {
    await signUp(page)
    await setupChatWithSelf(page)

    const messageInput = page.getByPlaceholder("Message").first()
    await messageInput.pressSequentially("Hello, this is a test message!")

    await messageInput.press("Shift+Enter")
    await messageInput.press("Shift+Enter")
    await messageInput.press("Shift+Enter")

    await messageInput.pressSequentially("This text should appear after three newlines")

    await messageInput.press("Enter")

    const expectedMessage =
      "Hello, this is a test message!\n\n\nThis text should appear after three newlines"
    await expect(
      page.locator(".whitespace-pre-wrap").getByText(expectedMessage)
    ).toBeVisible({timeout: 10000})
  })

  test("New lines are trimmed but exist in the middle of the message", async ({page}) => {
    await signUp(page)
    await setupChatWithSelf(page)

    const messageInput = page.getByPlaceholder("Message").first()
    await messageInput.fill(
      "\nHello, this is a test message!\nThis is a new line\nThis is another new line\n"
    )

    await messageInput.press("Enter")

    const expectedMessage =
      "Hello, this is a test message!\nThis is a new line\nThis is another new line"
    await expect(
      page.locator(".whitespace-pre-wrap").getByText(expectedMessage)
    ).toBeVisible({timeout: 10000})
  })

  test("textarea resizes based on content", async ({page}) => {
    await signUp(page)
    await setupChatWithSelf(page)

    const messageInput = page.getByPlaceholder("Message").first()

    const initialHeight = await messageInput.evaluate((el) => el.clientHeight)

    // Multiple newlines
    await messageInput.pressSequentially("Line 1")
    await messageInput.press("Shift+Enter")
    await messageInput.press("Shift+Enter")
    await messageInput.pressSequentially("Line 4")

    const heightAfterNewlines = await messageInput.evaluate((el) => el.clientHeight)
    expect(heightAfterNewlines).toBeGreaterThan(initialHeight)

    // Clear and verify height returns to initial
    await messageInput.fill("")
    const heightAfterClear = await messageInput.evaluate((el) => el.clientHeight)
    expect(heightAfterClear).toBe(initialHeight)

    // Long line that wraps
    const longLine =
      "This is a very long line that should definitely wrap multiple times in the textarea because it contains a lot of text that needs to be displayed across multiple lines in the UI"
    await messageInput.pressSequentially(longLine)

    const heightAfterWrapping = await messageInput.evaluate((el) => el.clientHeight)
    expect(heightAfterWrapping).toBeGreaterThan(initialHeight)

    // Clear again
    await messageInput.fill("")
    expect(await messageInput.evaluate((el) => el.clientHeight)).toBe(initialHeight)

    // Combined newlines and wrapping
    await messageInput.pressSequentially("First line with some text")
    await messageInput.press("Shift+Enter")
    await messageInput.pressSequentially(longLine)
    await messageInput.press("Shift+Enter")
    await messageInput.pressSequentially("Final line")

    const heightAfterCombined = await messageInput.evaluate((el) => el.clientHeight)
    expect(heightAfterCombined).toBeGreaterThan(heightAfterNewlines)
    expect(heightAfterCombined).toBeGreaterThan(heightAfterWrapping)
  })
})
