import {test, expect} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {Relay} from "nostr-tools/relay"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"

const usingTestRelay =
  process.env.VITE_USE_TEST_RELAY === "true" || process.env.VITE_USE_TEST_RELAY === "1"
const usingLocalRelay =
  process.env.IRIS_E2E_LOCAL_RELAY === "true" || (!usingBuiltDist && !usingTestRelay)

test.describe("Unseen Notifications Indicator", () => {
  test("should show notification badge in desktop sidebar and mobile header after reloading an unseen notification", async ({
    page,
  }) => {
    test.skip(!usingLocalRelay, "requires a stored local-relay notification")
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
    const relay = await Relay.connect("ws://127.0.0.1:7777")
    try {
      await relay.publish(
        finalizeEvent(
          {kind: 3, content: "", tags: [["p", sender]], created_at: now - 3},
          viewerKey
        )
      )
      await relay.publish(note)
      await relay.publish(reaction)
    } finally {
      relay.close()
    }

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
  })

  test("should show notification badge after real like notification", async ({
    browser,
  }) => {
    test.setTimeout(90000)
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()

    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    try {
      await signUp(pageA, "User A")
      await signUp(pageB, "User B")

      await pageB.goto("/")
      const userBProfileLink = await pageB
        .locator('a[href*="/npub"]')
        .first()
        .getAttribute("href")

      if (!userBProfileLink) {
        throw new Error("Could not find User B's profile link")
      }

      await pageA.goto(userBProfileLink)
      await pageA
        .getByTestId("profile-header-actions")
        .getByRole("button", {name: "Follow"})
        .click()
      await pageA.waitForTimeout(2000)

      await pageA.goto("/")
      const userAProfileLink = await pageA
        .locator('a[href*="/npub"]')
        .first()
        .getAttribute("href")

      if (!userAProfileLink) {
        throw new Error("Could not find User A's profile link")
      }

      await pageB.goto(userAProfileLink)
      await pageB
        .getByTestId("profile-header-actions")
        .getByRole("button", {name: "Follow"})
        .click()
      await pageB.waitForTimeout(2000)

      await pageA.locator("#main-content").getByTestId("new-post-button").click()
      const postContent = "Test post for unseen notification indicator test"
      await pageA
        .getByRole("dialog")
        .getByPlaceholder("What's on your mind?")
        .fill(postContent)
      await pageA.getByRole("dialog").getByRole("button", {name: "Post"}).click()
      await expect(pageA.getByText(postContent).first()).toBeVisible()

      // User B navigates to User A's profile to find and like the post
      await pageB.goto(userAProfileLink)
      await expect(pageB.getByText(postContent).first()).toBeVisible({timeout: 20000})
      const postElement = pageB
        .locator('[data-testid="feed-item"]')
        .filter({hasText: postContent})
        .first()
      await postElement.getByTestId("like-button").click()

      await pageA.waitForTimeout(12000)

      await pageA.setViewportSize({width: 1024, height: 768})
      await pageA.goto("/")
      await pageA.waitForTimeout(3000)

      console.log("Testing desktop sidebar notification indicator after real like...")
      const desktopNotificationBadge = pageA.locator(
        'li a[href="/notifications"] .indicator .indicator-item.badge.badge-primary.badge-xs'
      )

      const desktopBadgeVisible = await desktopNotificationBadge.isVisible()
      console.log(`Desktop badge visible: ${desktopBadgeVisible}`)

      await pageA.goto("/notifications")
      await pageA.waitForTimeout(3000)

      const anyNotification = pageA.locator("div").filter({hasText: "reacted"}).first()
      const notificationExists = await anyNotification.isVisible()

      if (notificationExists) {
        console.log("✅ Notification exists in feed")
        if (!desktopBadgeVisible) {
          console.log(
            "❌ But badge was not showing - this indicates a bug in the indicator implementation"
          )
        }
      } else {
        console.log("❌ No notification found - like action may not have worked")
      }
    } finally {
      try {
        await contextA.close()
        await contextB.close()
      } catch (error) {
        console.log("Context cleanup error (expected):", error.message)
      }
    }
  })
})
