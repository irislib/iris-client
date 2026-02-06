import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test.describe("Profile dropdown functionality", () => {
  test("dropdown button appears in header for other profiles and shows mute option", async ({
    page,
  }) => {
    // Sign up as a test user
    await signUp(page, "Test User")

    // Use a hardcoded npub to test profile functionality
    const testNpub = "npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk"

    // Navigate directly to the other user's profile
    await page.goto(`/${testNpub}`)

    // Wait for profile page to load
    await expect(page).toHaveURL(new RegExp(`${testNpub}/?$`))

    // Check that the header is visible
    const header = page.locator("header").first()
    await expect(header).toBeVisible()

    // Look for the dropdown button in the header using test-id
    const dropdownButton = page.getByTestId("profile-dropdown-button")
    await expect(dropdownButton).toBeVisible({timeout: 10000})

    // Click the dropdown button to open the menu
    await dropdownButton.click()

    // Wait for dropdown to be visible
    const dropdown = page.locator(".dropdown-content").first()
    await expect(dropdown).toBeVisible({timeout: 5000})

    // Check that the dropdown contains "Mute" text
    await expect(dropdown).toContainText("Mute")
  })

  test("dropdown button does not appear for own profile", async ({page}) => {
    // Sign up as a test user
    await signUp(page, "Test User")

    // Click on own avatar/profile link in sidebar to navigate to own profile
    const profileLink = page.locator('a[href*="npub"]').first()
    await expect(profileLink).toBeVisible({timeout: 10000})
    await profileLink.click()

    // Wait for profile page to load
    await page.waitForURL(/npub/, {timeout: 10000})

    // Wait for page to render
    await page.waitForLoadState("networkidle")

    // Check that profile-dropdown-button (mute/block menu) doesn't exist
    const dropdownButton = page.getByTestId("profile-dropdown-button")
    const hasDropdownButton = await dropdownButton.count()

    // Should not have a dropdown button for own profile
    expect(hasDropdownButton).toBe(0)
  })
})
