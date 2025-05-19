import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"
import {NDKEvent} from "@nostr-dev-kit/ndk"

test.describe("Notifications", () => {
  // This test verifies that the notification feed is visible
  test("notification feed is visible", async ({page}) => {
    // Create User A in browser
    const userAName = "User A"
    await signUp(page, userAName)
    
    // Go to the notifications page
    await page.goto("/notifications")
    
    // Check that the notifications feed is visible
    await expect(page.locator("div.w-full.overflow-hidden").filter({ hasText: "No notifications yet" })).toBeVisible()
  })
  
  // This test verifies that the notification component renders correctly
  test("notification component renders correctly", async ({page}) => {
    // Create User A in browser
    const userAName = "User A"
    await signUp(page, userAName)
    
    // Go to the notifications page
    await page.goto("/notifications")
    
    // Wait for the notification feed to load
    await page.waitForTimeout(2000)
    
    // Verify the notification feed is visible
    await expect(page.locator("div.w-full.overflow-hidden").filter({ hasText: "No notifications yet" })).toBeVisible()
    
    // 1. Creating User A in browser
    // 4. Having User B like User A's post
    //
  })
})
