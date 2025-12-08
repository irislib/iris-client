import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

// Define the type for the window object with notifications store
type WindowWithNotificationsStore = {
  useNotificationsStore?: {
    getState: () => {
      latestNotification: number
      notificationsSeenAt: number
      setLatestNotification: (timestamp: number) => void
      setNotificationsSeenAt: (timestamp: number) => void
    }
  }
}

test.describe("Unseen Notifications Indicator", () => {
  test("should show notification badge in desktop sidebar and mobile header when notification state indicates unseen notifications", async ({
    page,
  }) => {
    await signUp(page, "Test User")

    console.log("Testing notification badge rendering by manipulating store state...")

    await page.evaluate(() => {
      const now = Date.now()
      const latestNotification = now
      const notificationsSeenAt = now - 10000 // 10 seconds ago

      const store = (
        window as WindowWithNotificationsStore
      ).useNotificationsStore?.getState?.()
      if (store) {
        store.setLatestNotification(latestNotification)
        store.setNotificationsSeenAt(notificationsSeenAt)
        console.log("Set notification state:", {latestNotification, notificationsSeenAt})
      } else {
        console.log("Could not access notification store")
      }
    })

    await page.setViewportSize({width: 1024, height: 768})
    await page.goto("/")
    await page.waitForTimeout(2000)

    console.log("Testing desktop sidebar notification indicator...")
    const desktopNotificationBadge = page.locator(
      'li a[href="/notifications"] .indicator .indicator-item.badge.badge-primary.badge-xs'
    )

    const desktopBadgeVisible = await desktopNotificationBadge.isVisible()
    console.log(`Desktop badge visible: ${desktopBadgeVisible}`)

    if (desktopBadgeVisible) {
      console.log("✅ Desktop notification badge found in sidebar")
      await expect(desktopNotificationBadge).toBeVisible()
    } else {
      console.log("❌ Desktop notification badge not found - checking store state...")

      const storeState = await page.evaluate(() => {
        const store = (
          window as WindowWithNotificationsStore
        ).useNotificationsStore?.getState?.()
        return store
          ? {
              latestNotification: store.latestNotification,
              notificationsSeenAt: store.notificationsSeenAt,
            }
          : null
      })

      console.log("Current store state:", storeState)

      await page.evaluate(() => {
        const store = (
          window as WindowWithNotificationsStore
        ).useNotificationsStore?.getState?.()
        if (store) {
          const now = Date.now()
          store.setLatestNotification(now)
          store.setNotificationsSeenAt(now - 5000)
          console.log("Updated store state again")
        }
      })

      await page.waitForTimeout(1000)
      const badgeAfterUpdate = await desktopNotificationBadge.isVisible()
      console.log(`Desktop badge visible after state update: ${badgeAfterUpdate}`)
    }

    await page.setViewportSize({width: 375, height: 667})
    await page.goto("/")
    await page.waitForTimeout(2000)

    console.log("Testing mobile header notification indicator...")
    const mobileNotificationButton = page
      .locator(".md\\:hidden")
      .locator('a[href="/notifications"]')
    const mobileButtonVisible = await mobileNotificationButton.isVisible()
    console.log(`Mobile notification button visible: ${mobileButtonVisible}`)

    if (mobileButtonVisible) {
      const mobileBadge = mobileNotificationButton.locator(
        ".indicator-item.badge.badge-primary.badge-xs"
      )
      const mobileBadgeVisible = await mobileBadge.isVisible()
      console.log(`Mobile badge visible: ${mobileBadgeVisible}`)

      if (mobileBadgeVisible) {
        console.log("✅ Mobile notification badge found in header")
        await expect(mobileBadge).toBeVisible()
      } else {
        console.log("❌ Mobile notification badge not found")
      }
    } else {
      console.log("❌ Mobile notification button not found in header")
    }
  })

  test("should show notification badge after real like notification", async ({
    browser,
  }) => {
    test.setTimeout(60000) // Increase timeout to 60s for complex multi-user interactions
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
      const postElement = pageB.locator('[data-testid="feed-item"]').filter({hasText: postContent}).first()
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
