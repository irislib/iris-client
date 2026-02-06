import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("can follow user by npub", async ({page}) => {
  // Sign up
  await signUp(page)

  await expect(page).toHaveURL(/\/$/)

  // Find and fill the search input - use first one
  const targetNpub = "npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk"
  const searchInput = page.getByPlaceholder("Search").first()
  await searchInput.fill(targetNpub)
  await searchInput.press("Enter")

  // Wait for navigation away from root
  await expect(page).toHaveURL(new RegExp(`${targetNpub}/?$`))

  // Find and click the Follow button in profile header actions
  const headerActions = page.getByTestId("profile-header-actions")
  const followButton = headerActions.getByRole("button", {name: "Follow"})
  await followButton.click()

  // Move cursor away from button to avoid hover state showing "Unfollow"
  await page.mouse.move(0, 0)

  // Verify button text changes to "Following" (check visible span)
  await expect(followButton.locator("span.absolute")).toHaveText("Following")
})
