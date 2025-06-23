import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

async function setupChat(page) {
  const createInviteButton = page.getByRole("button", {name: "Create Invite Link"})
  await createInviteButton.click()
  await page.waitForTimeout(2000) // Wait for invite creation

  const qrButton = page.getByRole("button", {name: "Show QR Code"}).first()
  await qrButton.click()
  const inviteLink = await page.getByText(/^https:\/\/iris\.to/).textContent()
  expect(inviteLink).toBeTruthy()
  await page.keyboard.press("Escape")

  const inviteInput = page.getByPlaceholder("Paste invite link")
  await inviteInput.click()
  await page.keyboard.type(inviteLink!)
  await expect(page).toHaveURL(/\/chats\/chat/, {timeout: 10000})
}

test.describe("Message Form - Desktop", () => {
  test.beforeEach(async ({page}) => {
    await signUp(page)
    await page.getByRole("link", {name: "Chats"}).click()
    await expect(page.getByRole("banner").getByText("New Chat")).toBeVisible()
  })

  test("can send a basic text message using Enter key", async ({page}) => {
    await setupChat(page)

    const messageInput = page.getByPlaceholder("Message")
    const testMessage = "Hello, this is a test message!"
    await messageInput.fill(testMessage)
    await messageInput.press("Enter")

    await expect(page.getByRole("paragraph").filter({hasText: testMessage})).toBeVisible()

    await expect(page.getByRole("button", {name: "Send message"})).not.toBeVisible()
  })

  test("empty message cannot be sent", async ({page}) => {
    await setupChat(page)

    const messageInput = page.getByPlaceholder("Message")
    await messageInput.fill("   ") // Just spaces
    await messageInput.press("Enter")

    await expect(page.getByRole("paragraph").filter({hasText: "   "})).not.toBeVisible()
  })

  test("shift + enter adds a new line", async ({page}) => {
    await setupChat(page)

    const messageInput = page.getByPlaceholder("Message")
    await messageInput.fill("Hello, this is a test message!")
    await messageInput.press("Shift+Enter")

    await expect(messageInput).toHaveValue("Hello, this is a test message!\n")
  })

  test("multiple shift + enter presses add multiple new lines", async ({page}) => {
    await setupChat(page)

    const messageInput = page.getByPlaceholder("Message")
    await messageInput.pressSequentially("Hello, this is a test message!")

    await messageInput.press("Shift+Enter")
    await messageInput.press("Shift+Enter")
    await messageInput.press("Shift+Enter")

    await messageInput.pressSequentially("This text should appear after three newlines")

    await messageInput.press("Enter")

    const expectedMessage =
      "Hello, this is a test message!\n\n\nThis text should appear after three newlines"
    await expect(
      page.getByRole("paragraph").filter({hasText: expectedMessage})
    ).toBeVisible()
  })

  test("New lines are trimmed but exist in the middle of the message", async ({page}) => {
    await setupChat(page)

    const messageInput = page.getByPlaceholder("Message")
    await messageInput.fill(
      "\nHello, this is a test message!\nThis is a new line\nThis is another new line\n"
    )

    await messageInput.press("Enter")

    const expectedMessage =
      "Hello, this is a test message!\nThis is a new line\nThis is another new line"
    await expect(
      page.getByRole("paragraph").filter({hasText: expectedMessage})
    ).toBeVisible()
  })

  test("textarea resizes based on content", async ({page}) => {
    await setupChat(page)

    const messageInput = page.getByPlaceholder("Message")

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
