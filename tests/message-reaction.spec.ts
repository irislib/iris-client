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

test("user can react to a chat message", async ({page}) => {
  await signUp(page)
  await setupChatWithSelf(page)

  const messageInput = page.getByPlaceholder("Message")
  const text = "Reaction test"
  await messageInput.fill(text)
  await messageInput.press("Enter")
  await expect(page.locator(".whitespace-pre-wrap").getByText(text)).toBeVisible({
    timeout: 10000,
  })

  // Give the message time to be fully processed
  await page.waitForTimeout(1000)

  await page.getByTestId("reaction-button").first().click()
  await page.getByRole("button", {name: "👍"}).first().click()

  // Wait for reaction to be sent and displayed
  await page.waitForTimeout(2000)

  // Check if the reaction appears on the message
  // Look for reaction elements that contain the thumbs up
  const messageReactions = page.locator("div").filter({hasText: /^👍$/})
  const count = await messageReactions.count()
  console.log(`Found ${count} reaction elements with 👍`)
  expect(count).toBeGreaterThanOrEqual(1)
})
