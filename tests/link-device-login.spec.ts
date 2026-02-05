import {test, expect} from "@playwright/test"

test("link device entry opens from login dialog", async ({page}) => {
  await page.goto("/")
  await page.waitForLoadState("domcontentloaded")

  const signUpHeading = page.getByRole("heading", {name: "Sign up"})
  const signInHeading = page.getByRole("heading", {name: "Sign in"})

  if (!(await signUpHeading.isVisible()) && !(await signInHeading.isVisible())) {
    const signUpButton = page.locator("button:visible", {hasText: "Sign up"}).first()
    await expect(signUpButton).toBeVisible({timeout: 10000})
    await signUpButton.click()
    await expect(page.locator("dialog.modal")).toBeVisible({timeout: 10000})
  }

  const linkButton = page.getByRole("button", {name: "Link this device"})
  await expect(linkButton).toBeVisible({timeout: 10000})
  await linkButton.click()

  await expect(page.getByRole("heading", {name: "Link this device"})).toBeVisible({
    timeout: 10000,
  })
})
