import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("can create and use private invite link to chat with self", async ({page}) => {
  // Sign up
  await signUp(page)

  // Navigate to messages via navbar
  await page.getByRole("link", {name: "Messages"}).click()
  await expect(page.getByRole("banner").getByText("New Chat")).toBeVisible()

  // Create a new invite link
  const createInviteButton = page.getByRole("button", {name: "Create Invite Link"})
  await createInviteButton.click()

  // Wait for the Private Invite section and get its URL
  await expect(page.getByText("Private Invite")).toBeVisible()
  const qrButton = page
    .getByText("Private Invite")
    .locator("..")
    .getByRole("button", {name: "Show QR Code"})
  await qrButton.click()

  // Get the URL from the QR dialog
  const inviteLink = await page.getByText(/^https:\/\/iris\.to/).textContent()
  expect(inviteLink).toBeTruthy()

  // Close the QR modal
  await page.keyboard.press("Escape")

  // Paste the invite link and wait for navigation
  const inviteInput = page.getByPlaceholder("Paste invite link")
  await inviteInput.click()
  await page.keyboard.type(inviteLink!)

  // Wait for navigation to chat view with a longer timeout since encryption takes time
  await expect(page).toHaveURL(/\/messages\/chat/, {timeout: 10000})

  // Verify we can send a message
  const messageInput = page.getByPlaceholder("Message")
  await messageInput.fill("Hello")
  await messageInput.press("Enter")

  // Verify message appears in chat
  await expect(page.getByRole("paragraph").filter({hasText: "Hello"})).toBeVisible()
})
