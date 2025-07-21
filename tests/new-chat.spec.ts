import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("can search for self and start a private chat via user search", async ({page}) => {
  // Sign up and get username
  const username = await signUp(page)

  // Navigate to chats via navbar
  await page.getByRole("link", {name: "Chats"}).click()
  await expect(page.locator("header").getByText("New Chat")).toBeVisible({timeout: 10000})

  // Click the New Chat link to go to /chats/new
  await page.getByRole("link", {name: /New Chat/}).click()
  await expect(page).toHaveURL(/\/chats\/new/)

  // Wait for the search input to be visible
  const searchInput = page.getByPlaceholder("Search for users")
  await expect(searchInput).toBeVisible()

  // Search for self by username
  await searchInput.fill(username)
  await page.waitForTimeout(1000) // Wait for search results to update

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

  // Verify we can send a message
  const messageInput = page.getByPlaceholder("Message")
  await messageInput.fill("Hello")
  await messageInput.press("Enter")

  // Verify message appears in chat
  await expect(page.getByRole("paragraph").filter({hasText: "Hello"})).toBeVisible()
})
