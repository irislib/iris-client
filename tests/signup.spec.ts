import {test, expect} from "@playwright/test"

test("user can sign up without a name", async ({page}) => {
  // Start from the home page
  await page.goto("/")

  // Wait for any signup button to be visible and click it
  const signUpButtons = page.locator(".signup-btn")
  const visibleButton = signUpButtons.filter({hasText: "Sign up"}).first()
  await visibleButton.waitFor({state: "visible", timeout: 10000})
  await visibleButton.click()

  // Wait for the signup dialog to appear
  await expect(page.getByRole("heading", {name: "Sign up"})).toBeVisible()

  // Don't enter a name, just click Go
  const goButton = page.getByRole("button", {name: "Go"})
  await goButton.click()

  // Wait for signup to complete
  await expect(page.getByRole("heading", {name: "Sign up"})).not.toBeVisible()
  await expect(page.locator("#main-content").getByTestId("new-post-button")).toBeVisible()
})
