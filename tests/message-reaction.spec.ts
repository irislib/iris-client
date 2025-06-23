import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

async function setupChat(page) {
  const createInviteButton = page.getByRole("button", {name: "Create Invite Link"})
  await createInviteButton.click()
  await page.waitForTimeout(2000)
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

test("user can react to a chat message", async ({page}) => {
  await signUp(page)
  await page.getByRole("link", {name: "Chats"}).click()
  await expect(page.getByRole("banner").getByText("New Chat")).toBeVisible()
  await setupChat(page)

  const messageInput = page.getByPlaceholder("Message")
  const text = "Reaction test"
  await messageInput.fill(text)
  await messageInput.press("Enter")
  await expect(page.getByRole("paragraph").filter({hasText: text})).toBeVisible()

  await page.getByTestId("reaction-button").click()
  await page.getByRole("button", {name: "👍"}).first().click()

  await expect(page.getByText("👍")).toBeVisible()
})
