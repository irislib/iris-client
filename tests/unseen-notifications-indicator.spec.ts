import {test, expect} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {signUp} from "./auth.setup"
import {startNostrRelay} from "../dev-relay/nostr-relay"

test.describe("Unseen Notifications Indicator", () => {
  test("should show notification badge in desktop sidebar and mobile header after reloading an unseen notification", async ({
    page,
  }) => {
    const viewerKey = generateSecretKey()
    const senderKey = generateSecretKey()
    const viewer = getPublicKey(viewerKey)
    const sender = getPublicKey(senderKey)
    const now = Math.floor(Date.now() / 1000)
    const content = `Stored badge notification ${viewer.slice(0, 12)}`
    const note = finalizeEvent(
      {kind: 1, content, tags: [], created_at: now - 2},
      viewerKey
    )
    const reaction = finalizeEvent(
      {
        kind: 7,
        content: "+",
        tags: [
          ["e", note.id],
          ["p", viewer],
        ],
        created_at: now - 1,
      },
      senderKey
    )
    const relay = await startNostrRelay({
      port: 0,
      initialEvents: [
        finalizeEvent(
          {kind: 3, content: "", tags: [["p", sender]], created_at: now - 3},
          viewerKey
        ),
        note,
        reaction,
      ],
    })
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
    try {
      await signUp(page, nip19.nsecEncode(viewerKey))
      await page.setViewportSize({width: 1024, height: 768})
      const desktopBadge = page.locator(
        'li a[href="/notifications"] .indicator .indicator-item.badge.badge-primary.badge-xs'
      )
      // Wait for real graph admission and history delivery before testing recovery.
      await expect(desktopBadge).toBeVisible({timeout: 15000})
      await page.reload()
      await expect(desktopBadge).toBeVisible({timeout: 15000})
      await page.setViewportSize({width: 375, height: 667})
      await page.reload()
      const mobileNotifications = page.locator('.md\\:hidden a[href="/notifications"]')
      await expect(mobileNotifications).toBeVisible()
      await expect(
        mobileNotifications.locator(".indicator-item.badge.badge-primary.badge-xs")
      ).toBeVisible({timeout: 15000})
      await mobileNotifications.click()
      const notification = page
        .locator('div[class*="bg-info/20"]')
        .filter({hasText: "reacted"})
      await expect(notification).toBeVisible()
      await expect(notification.getByText(content, {exact: true})).toBeVisible()
      await expect(
        notification.locator(`a[href="/${nip19.npubEncode(sender)}"]`)
      ).toBeVisible()
    } finally {
      await page.close()
      await relay.close()
    }
  })

  test("should show notification badge after real like notification", async ({
    browser,
  }) => {
    test.setTimeout(90000)
    const viewerKey = generateSecretKey()
    const senderKey = generateSecretKey()
    const viewer = getPublicKey(viewerKey)
    const sender = getPublicKey(senderKey)
    const relay = await startNostrRelay({
      port: 0,
      initialEvents: [
        finalizeEvent(
          {
            kind: 3,
            content: "",
            tags: [["p", sender]],
            created_at: Math.floor(Date.now() / 1000) - 1,
          },
          viewerKey
        ),
      ],
    })
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    for (const context of [contextA, contextB])
      await context.addInitScript((port) => {
        window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
      }, relay.port)
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()
    try {
      await signUp(pageA, nip19.nsecEncode(viewerKey))
      await signUp(pageB, nip19.nsecEncode(senderKey))
      await pageA.locator("#main-content").getByTestId("new-post-button").click()
      const postContent = `Unseen notification indicator ${viewer.slice(0, 12)}`
      const composer = pageA.getByRole("dialog")
      await composer.getByPlaceholder("What's on your mind?").fill(postContent)
      await composer.getByRole("button", {name: "Post", exact: true}).click()
      await expect(pageA.getByText(postContent).first()).toBeVisible()
      // Viewing the post consumes its reactions immediately. Move away before
      // delivery so this checks a genuinely unseen notification.
      await pageA.goto("/settings")
      await expect(pageA.getByText(postContent, {exact: true})).toHaveCount(0)
      await pageB.goto(`/${nip19.npubEncode(viewer)}`)
      const post = pageB.getByTestId("feed-item").filter({hasText: postContent}).first()
      await expect(post).toBeVisible({timeout: 20000})
      await post.getByTestId("like-button").click()
      await expect(post.getByTestId("like-count")).toHaveText("1")
      await pageA.setViewportSize({width: 1024, height: 768})
      const badge = pageA.locator(
        'li a[href="/notifications"] .indicator .indicator-item.badge.badge-primary.badge-xs'
      )
      await expect(badge).toBeVisible({timeout: 30000})
      await pageA.locator('li a[href="/notifications"]').click()
      const notification = pageA
        .locator('div[class*="bg-info/20"]')
        .filter({hasText: "reacted"})
      await expect(notification.getByText(postContent, {exact: true})).toBeVisible()
      await expect(
        notification.locator(`a[href="/${nip19.npubEncode(sender)}"]`)
      ).toBeVisible()
      await expect(badge).not.toBeVisible()
    } finally {
      await Promise.all([contextA.close(), contextB.close()])
      await relay.close()
    }
  })
})
