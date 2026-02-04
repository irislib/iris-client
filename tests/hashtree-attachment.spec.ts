import {test, expect} from "@playwright/test"
import {fileURLToPath} from "url"
import {signUp} from "./auth.setup"

async function setupChatWithSelf(page) {
  await page.getByRole("link", {name: "Chats"}).click()
  await page.getByRole("link", {name: "Devices"}).click()

  const registerButton = page.getByRole("button", {name: "Register this device"})
  if (await registerButton.isVisible()) {
    await registerButton.click()
    await expect(registerButton).not.toBeVisible({timeout: 15000})
  }

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

test.describe("Hashtree Attachment", () => {
  test("can attach and display an image in DMs", async ({page}) => {
    test.setTimeout(60000)
    await signUp(page)
    await setupChatWithSelf(page)

    await page.getByTestId("chat-actions-toggle").last().click()

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("chat-attachment-button").last().click(),
    ])

    const fixturePath = fileURLToPath(new URL("fixtures/test-blob.jpeg", import.meta.url))
    await fileChooser.setFiles(fixturePath)

    const messageInput = page.getByPlaceholder("Message").last()
    await expect(messageInput).toHaveValue(/nhash1/i, {timeout: 30000})

    await messageInput.press("Enter")

    const attachment = page.locator('[data-testid="hashtree-attachment"]').last()
    await expect(attachment).toBeVisible({timeout: 30000})

    const attachmentImage = attachment.locator("img")
    await expect(attachmentImage).toBeVisible({timeout: 30000})
    await expect(attachmentImage).toHaveAttribute("src", /blob:/)
  })

  test("can open hashtree image in full size modal", async ({page}) => {
    test.setTimeout(60000)
    await signUp(page)
    await setupChatWithSelf(page)

    await page.getByTestId("chat-actions-toggle").last().click()

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("chat-attachment-button").last().click(),
    ])

    const fixturePath = fileURLToPath(new URL("fixtures/test-blob.jpeg", import.meta.url))
    await fileChooser.setFiles(fixturePath)

    const messageInput = page.getByPlaceholder("Message").last()
    await expect(messageInput).toHaveValue(/nhash1/i, {timeout: 30000})

    await messageInput.press("Enter")

    const attachment = page.locator('[data-testid="hashtree-attachment"]').last()
    await expect(attachment).toBeVisible({timeout: 30000})

    const attachmentImage = attachment.locator("img")
    await expect(attachmentImage).toBeVisible({timeout: 30000})

    // Click the image to open modal
    await attachmentImage.click()

    // Verify modal is visible by checking for the dialog element
    const modal = page.locator("dialog.modal")
    await expect(modal).toBeVisible({timeout: 5000})

    // Verify image is displayed in modal with full size
    const modalImage = modal.locator("img").first()
    await expect(modalImage).toBeVisible({timeout: 5000})
    await expect(modalImage).toHaveClass(/max-w-full max-h-full/)

    // Close modal by pressing Escape or clicking close button
    await page.keyboard.press("Escape")
    await expect(modal).not.toBeVisible({timeout: 5000})
  })
})
