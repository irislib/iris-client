import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

async function setupChatWithSelf(page, username) {
  await page.getByRole("link", {name: "Chats"}).click()
  await expect(page.locator("header").getByText("New Chat")).toBeVisible({timeout: 10000})
  const searchInput = page.getByPlaceholder("Search for users")
  await searchInput.fill(username)
  await page.waitForTimeout(1000)
  const selfButton = page.getByRole("button", {name: username})
  await selfButton.click()
  await expect(page).toHaveURL(/\/chats\/chat/, {timeout: 10000})
}

test("user can react to a chat message", async ({page}) => {
  const username = await signUp(page)
  await setupChatWithSelf(page, username)

  const messageInput = page.getByPlaceholder("Message")
  const text = "Reaction test"
  await messageInput.fill(text)
  await messageInput.press("Enter")
  await expect(page.getByRole("paragraph").filter({hasText: text})).toBeVisible()

  await page.getByTestId("reaction-button").click()
  await page.getByRole("button", {name: "👍"}).first().click()

  await expect(page.getByText("👍")).toBeVisible()
})
