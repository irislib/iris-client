import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("UnseenMessagesBadge component is integrated in desktop and mobile navigation", async ({
  page,
}) => {
  await signUp(page, "Test User")

  await page.setViewportSize({width: 1200, height: 800})
  await page.waitForTimeout(1000)

  const desktopMessagesLink = page.locator('a[href*="chats"]').first()
  await expect(desktopMessagesLink).toBeVisible()

  const desktopIndicatorSpan = page.locator('a[href*="chats"] .indicator').first()
  await expect(desktopIndicatorSpan).toBeAttached()

  await page.setViewportSize({width: 375, height: 667})
  await page.waitForTimeout(1000)

  const mobileMessagesLink = page.locator('footer a[href*="chats"]')
  await expect(mobileMessagesLink).toBeVisible()

  const mobileIndicatorSpan = page.locator('footer a[href*="chats"] .indicator')
  await expect(mobileIndicatorSpan).toBeAttached()
})

//
//
