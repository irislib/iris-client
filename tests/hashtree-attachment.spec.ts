import {test, expect} from "@playwright/test"
import {fileURLToPath} from "url"
import {signUp} from "./auth.setup"

async function setupChatWithSelf(page) {
  await page.getByRole("link", {name: "Chats"}).click()
  await page.getByRole("link", {name: "Devices"}).click()

  const registerButton = page.getByRole("button", {name: "Register this device"})
  if (await registerButton.isVisible({timeout: 2000}).catch(() => false)) {
    await expect(registerButton).not.toBeVisible({timeout: 15000})
  }

  const profileLink = page.locator('[data-testid="sidebar-user-row"]').first()
  await profileLink.click()
  // Avoid networkidle (app uses persistent connections); wait for UI instead.
  await page.waitForLoadState("domcontentloaded")

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

  test("pauses hashtree videos when scrolled out of view", async ({page}) => {
    test.setTimeout(90000)
    await page.setViewportSize({width: 1280, height: 500})

    await signUp(page)
    await setupChatWithSelf(page)

    await page.getByTestId("chat-actions-toggle").last().click()

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("chat-attachment-button").last().click(),
    ])

    const fixturePath = fileURLToPath(new URL("fixtures/test-blob.mp4", import.meta.url))
    await fileChooser.setFiles(fixturePath)

    const messageInput = page.getByPlaceholder("Message").last()
    await expect(messageInput).toHaveValue(/nhash1/i, {timeout: 30000})
    await messageInput.press("Enter")

    const attachment = page.locator('[data-testid="hashtree-attachment"]').last()
    await expect(attachment).toBeVisible({timeout: 30000})

    // Video is not auto-loaded, so load it explicitly.
    await attachment.getByRole("button", {name: /Load .*\.mp4/}).click()

    const attachmentVideo = attachment.locator("video")
    await expect(attachmentVideo).toBeVisible({timeout: 30000})
    await expect(attachmentVideo).toHaveAttribute("src", /blob:/)

    // Start playback (muted to satisfy autoplay policies in headless Chrome).
    await attachmentVideo.evaluate(async (video) => {
      video.muted = true
      await video.play().catch(() => {})
    })

    await expect
      .poll(() => attachmentVideo.evaluate((v) => v.paused), {timeout: 5000})
      .toBe(false)
    await expect
      .poll(() => attachmentVideo.evaluate((v) => v.currentTime), {timeout: 5000})
      .toBeGreaterThan(0)

    // Seed enough content to make the chat scroll, then scroll away from the video.
    // (Avoids relying on long messages, which may be truncated in UI rendering.)
    await page.evaluate(async () => {
      const raw = localStorage.getItem("user-storage")
      if (!raw) throw new Error("Missing user-storage")
      const parsed = JSON.parse(raw)
      const myPubKey = parsed?.state?.publicKey as string | undefined
      if (!myPubKey) throw new Error("Missing publicKey in user-storage")

      const store = (
        window as unknown as {
          usePrivateMessagesStore?: {
            getState: () => {
              awaitHydration: () => Promise<void>
              upsert: (from: string, to: string, event: any) => Promise<void>
            }
          }
        }
      ).usePrivateMessagesStore?.getState?.()

      if (!store) {
        throw new Error("usePrivateMessagesStore not available on window")
      }

      await store.awaitHydration()

      const base = Date.now()
      // Keep total messages <= ChatContainer's initial render window (25) so the video stays mounted.
      for (let i = 0; i < 20; i++) {
        const nowMs = base + i * 10
        const hexId = (base + i).toString(16).padStart(64, "0")
        const content = Array.from({length: 12}, (_, j) => `filler ${i}-${j}`).join("\n")
        await store.upsert(myPubKey, myPubKey, {
          id: hexId,
          pubkey: myPubKey,
          ownerPubkey: myPubKey,
          created_at: Math.floor(nowMs / 1000),
          kind: 14, // nostr-double-ratchet CHAT_MESSAGE_KIND
          tags: [["ms", String(nowMs)]],
          content,
        })
      }
    })

    const chatScrollContainer = attachmentVideo.locator(
      "xpath=ancestor::*[@data-header-scroll-target][1]"
    )
    await chatScrollContainer.evaluate((el: HTMLElement) => {
      el.scrollTop = el.scrollHeight
    })

    await expect
      .poll(
        () =>
          attachmentVideo.evaluate((v) => {
            const r = v.getBoundingClientRect()
            return r.top > window.innerHeight || r.bottom < 0
          }),
        {timeout: 15000}
      )
      .toBe(true)

    // Once it's out of view, it should pause.
    await expect
      .poll(() => attachmentVideo.evaluate((v) => v.paused), {timeout: 15000})
      .toBe(true)
  })
})
