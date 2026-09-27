import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"
import {ensureCurrentDeviceRegistered} from "./private-messaging-helpers"

test("can start a private chat with self via profile", async ({page}) => {
  test.setTimeout(60000)
  // Finish device setup before starting a private chat.
  await signUp(page)
  await ensureCurrentDeviceRegistered(page)

  // Go to own profile via the sidebar user row
  const profileLink = page.locator('[data-testid="sidebar-user-row"]').first()
  await profileLink.click()

  // Wait for profile to load
  await expect(page.getByTestId("profile-header-actions")).toBeVisible({timeout: 10000})

  // Click the mail/message button (it's a circle button with mail-outline icon)
  const messageButton = page
    .getByTestId("profile-header-actions")
    .locator("button.btn-circle")
    .first()
  await expect(messageButton).toBeVisible({timeout: 5000})
  await messageButton.click()

  // Wait for navigation to chat view
  await expect(page).toHaveURL(/\/chats\/chat/, {timeout: 10000})

  // Find the message input and send a message
  const messageInput = page.getByRole("textbox", {name: "Message input", exact: true})
  await expect(messageInput).toBeVisible({timeout: 5000})
  await messageInput.fill("Hello from self-chat")
  await messageInput.press("Enter")

  // Verify message appears in chat
  await expect(
    page.locator(".whitespace-pre-wrap:visible").getByText("Hello from self-chat")
  ).toBeVisible({timeout: 10000})
})
