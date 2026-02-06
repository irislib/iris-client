import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

async function setupChatWithSelf(page) {
  // Go to own profile via the sidebar user row
  const profileLink = page.locator('[data-testid="sidebar-user-row"]').first()
  await profileLink.click()
  // Avoid networkidle (app uses persistent connections); wait for UI instead.
  await page.waitForLoadState("domcontentloaded")

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
  test.setTimeout(60000)
  await signUp(page)
  await setupChatWithSelf(page)

  const messageInput = page.getByPlaceholder("Message")
  const text = "Reaction test"
  await messageInput.fill(text)
  await messageInput.press("Enter")
  const messageBody = page.locator(".whitespace-pre-wrap").getByText(text).first()
  await expect(messageBody).toBeVisible({timeout: 10000})

  // React on the message we just sent (avoids flakiness if the chat has older messages).
  const messageRow = messageBody.locator("xpath=ancestor::div[@id][1]")
  await messageRow.getByTestId("reaction-button").click()
  await page.getByRole("button", {name: "👍"}).first().click()

  // Reaction should show up on that message.
  await expect(messageRow.locator("span").filter({hasText: "👍"}).first()).toBeVisible({
    timeout: 15000,
  })
})
