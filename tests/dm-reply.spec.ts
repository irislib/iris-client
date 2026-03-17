import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

async function waitForNextCreatedAtSecond() {
  const currentSecond = Math.floor(Date.now() / 1000)
  while (Math.floor(Date.now() / 1000) === currentSecond) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function ensureDeviceRegistered(page) {
  const registerButton = page.getByRole("button", {name: "Register this device"})

  if (await registerButton.isVisible({timeout: 2000}).catch(() => false)) {
    await registerButton.waitFor({state: "hidden", timeout: 3000}).catch(() => {})

    if (await registerButton.isVisible().catch(() => false)) {
      await waitForNextCreatedAtSecond()
      await registerButton.click({timeout: 10000})

      const confirmHeading = page.getByRole("heading", {
        name: "Confirm Device Registration",
      })
      if (await confirmHeading.isVisible({timeout: 2000}).catch(() => false)) {
        const confirmButton = page.getByRole("button", {name: "Register Device"})
        await confirmButton.scrollIntoViewIfNeeded().catch(() => {})
        await confirmButton.click({
          timeout: 10000,
          force: true,
        })
      }

      await expect(registerButton).not.toBeVisible({timeout: 20000})
    }
  }
}

async function setupChatWithSelf(page) {
  await page.getByRole("link", {name: "Chats"}).click()
  await page.getByRole("link", {name: "Devices"}).click()
  await ensureDeviceRegistered(page)

  const profileLink = page.locator('[data-testid="sidebar-user-row"]').first()
  await profileLink.click()
  await page.waitForLoadState("networkidle")

  await expect(page.getByTestId("profile-header-actions")).toBeVisible({timeout: 10000})

  const messageButton = page
    .getByTestId("profile-header-actions")
    .locator("button.btn-circle")
    .first()
  await expect(messageButton).toBeVisible({timeout: 5000})
  await messageButton.click()

  await expect(page.getByPlaceholder("Message").last()).toBeVisible({timeout: 15000})
}

test.describe("DM Reply", () => {
  test("reply preview shows correct author name in DMs", async ({page}) => {
    test.setTimeout(60000)
    await signUp(page)
    await setupChatWithSelf(page)

    // Send first message
    const firstMessage = "First message to reply to"
    const messageInput = page.getByPlaceholder("Message").last()
    await messageInput.fill(firstMessage)
    await messageInput.press("Enter")

    // Wait for first message to appear
    await expect(page.getByText(firstMessage).last()).toBeVisible({timeout: 10000})

    // Click reply button on the first message
    // Need to hover over message to make reply button visible
    const messageContainer = page.locator(".group").filter({hasText: firstMessage}).last()
    await messageContainer.hover()
    const replyButton = messageContainer.getByTestId("reply-button")
    await expect(replyButton).toBeVisible({timeout: 5000})
    await replyButton.click()

    // Small wait for UI to update
    await page.waitForTimeout(500)

    // Send reply
    const replyMessage = "This is a reply"
    await messageInput.fill(replyMessage)
    await messageInput.press("Enter")

    // Wait for reply to appear
    await expect(page.getByText(replyMessage).last()).toBeVisible({timeout: 10000})

    // Find the reply preview in the sent message (has border-l-2 class and is clickable)
    const replyPreview = page
      .locator(".border-l-2.cursor-pointer")
      .filter({hasText: firstMessage})
      .last()
    await expect(replyPreview).toBeVisible({timeout: 5000})

    // Verify the author name is "You" (not the actual name)
    // The reply preview shows author name in a font-semibold div
    await expect(replyPreview.locator(".font-semibold", {hasText: "You"})).toBeVisible({
      timeout: 5000,
    })

    // Verify the replied message content is shown
    await expect(replyPreview.getByText(firstMessage, {exact: false})).toBeVisible({
      timeout: 5000,
    })
  })
})
