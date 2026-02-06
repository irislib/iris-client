import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test.describe("Stack Navigation", () => {
  test("back/forward navigation should work correctly", async ({page}) => {
    await signUp(page)

    // Navigate to about page
    await page.getByRole("link", {name: "About"}).click()
    await expect(page).toHaveURL(/\/about/)

    // Navigate to search
    await page.getByRole("link", {name: "Search"}).click()
    await expect(page).toHaveURL(/\/u/)

    // Navigate back to home
    await page.getByRole("link", {name: "Home", exact: true}).click()
    await expect(page).toHaveURL(/\/$/)

    console.log("Navigation complete, testing back button...")

    // Test back navigation
    await page.goBack()
    await expect(page).toHaveURL(/\/u$/)
    console.log("Back to search: ", page.url())

    await page.goBack()
    await expect(page).toHaveURL(/\/about$/)
    console.log("Back to about: ", page.url())

    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
    console.log("Back to home: ", page.url())

    // Test forward navigation
    await page.goForward()
    await expect(page).toHaveURL(/\/about$/)
    console.log("Forward to about: ", page.url())

    await page.goForward()
    await expect(page).toHaveURL(/\/u$/)
    console.log("Forward to search: ", page.url())
  })

  test("settings navigation with back button", async ({page}) => {
    await signUp(page)

    // Navigate to settings
    await page.getByRole("link", {name: "Settings"}).click()
    await expect(page).toHaveURL(/\/settings/)
    console.log("Navigated to settings")

    // Navigate to network settings tab
    await page.getByRole("link", {name: "Network"}).click()
    await expect(page).toHaveURL(/\/settings\/network/)
    console.log("Navigated to network settings")

    // Navigate to appearance settings tab
    await page.getByRole("link", {name: "Appearance"}).click()
    await expect(page).toHaveURL(/\/settings\/appearance/)
    console.log("Navigated to appearance settings")

    // Go back
    await page.goBack()
    await expect(page).toHaveURL(/\/settings\/network$/)
    console.log("After first back button, URL is:", page.url())

    // Go back again
    await page.goBack()
    await expect(page).toHaveURL(/\/settings$/)
    console.log("After second back button, URL is:", page.url())

    // Go back to home
    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
    console.log("After third back button, URL is:", page.url())
  })
})
