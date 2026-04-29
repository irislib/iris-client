import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"
import {ensureCurrentDeviceRegistered} from "./private-messaging-helpers"
import {usingBuiltDist} from "./utils/built-dist"

test.skip(usingBuiltDist, "requires local-relay private messaging group setup")

test("can create and use a group chat with self", async ({page}) => {
  test.setTimeout(60000)
  await signUp(page)

  // Navigate to Chats and register device first (required for private messaging)
  await page.getByRole("link", {name: "Chats"}).click()
  await ensureCurrentDeviceRegistered(page)

  // Navigate to group creation
  await page.getByRole("link", {name: "Group"}).click()

  // No members needed (self is always included)
  // Click Next to go to details step
  await page.getByRole("button", {name: /Next/}).click()

  // Fill in group details
  await page.getByPlaceholder("Enter group name").fill("Test Group")
  await page.getByRole("button", {name: "Create Group"}).click()

  // Verify navigation to group chat
  await expect(page).toHaveURL(/\/chats\/group\//)

  // Wait for message input to be enabled (not disabled)
  const messageInput = page.getByPlaceholder("Message").last()
  await expect(messageInput).toBeEnabled({timeout: 15000})

  // Send a message
  await messageInput.fill("Hello group")
  await messageInput.press("Enter")

  // Verify message appears (use .last() as the group chat is the most recent view)
  await expect(
    page.locator(".whitespace-pre-wrap").getByText("Hello group").last()
  ).toBeVisible({timeout: 10000})
})
