import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("can create and use a group chat with self", async ({page}) => {
  test.setTimeout(60000)
  await signUp(page)

  // Navigate to Chats and register device first (required for private messaging)
  await page.getByRole("link", {name: "Chats"}).click()

  // Go to Devices tab and register this device
  await page.getByRole("link", {name: "Devices"}).click()
  await expect(page).toHaveURL(/\/chats\/new\/devices/)
  await expect(page.getByRole("button", {name: "Link another device"})).toBeVisible({
    timeout: 10000,
  })

  const registerButton = page.getByRole("button", {name: "Register this device"})
  const thisDeviceBadge = page.getByText("This device").first()

  if (!(await thisDeviceBadge.isVisible().catch(() => false))) {
    if (await registerButton.isVisible({timeout: 2000}).catch(() => false)) {
      // The devices store starts out empty, so the register button can appear briefly even when
      // the current device is already registered. Give it a moment to settle before clicking.
      await Promise.race([
        thisDeviceBadge.waitFor({state: "visible", timeout: 3000}),
        registerButton.waitFor({state: "hidden", timeout: 3000}),
      ]).catch(() => {})

      if (
        !(await thisDeviceBadge.isVisible().catch(() => false)) &&
        (await registerButton.isVisible().catch(() => false))
      ) {
      await registerButton.click({timeout: 10000})

      // If there are existing devices, registration requires confirmation.
      const confirmHeading = page.getByRole("heading", {
        name: "Confirm Device Registration",
      })
      if (await confirmHeading.isVisible({timeout: 2000}).catch(() => false)) {
        await page.getByRole("button", {name: "Register Device"}).click({timeout: 10000})
      }

      await expect(thisDeviceBadge).toBeVisible({timeout: 20000})
      await expect(registerButton).not.toBeVisible({timeout: 20000})
      }
    }
  }

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
