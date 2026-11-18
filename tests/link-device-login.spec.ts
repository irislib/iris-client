import {test, expect} from "@playwright/test"

test("login offers a browser extension and keeps device pairing in Devices", async ({
  page,
}) => {
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
  await expect(linkButton).toHaveCount(0)
  if (!(await signInHeading.isVisible()))
    await page.getByRole("button", {name: "Sign in", exact: true}).click()
  const extension = page.getByRole("button", {name: "Nostr Extension Login"})
  await expect(extension).toHaveCount(0)
  await expect(linkButton).toHaveCount(0)
  await expect(page.getByRole("alert")).toHaveCount(0)
  // A signer can be enabled after the dialog is already open.
  await page.evaluate(() => {
    Object.defineProperty(window, "nostr", {
      value: {getPublicKey: async () => "12".repeat(32)},
    })
  })
  await extension.click()
  await expect(page.locator("dialog.modal:visible")).toHaveCount(0)
  await page.evaluate(() => localStorage.clear())
  await page.goto("/settings/devices")
  await expect(linkButton).toHaveCount(0)
  await page.goto("/chats")
  await page.getByRole("link", {name: "Link a chat device"}).click()
  await expect(linkButton).toBeVisible({timeout: 10000})
  await linkButton.click()

  await expect(page.getByRole("heading", {name: "Link this device"})).toBeVisible({
    timeout: 10000,
  })

  const copyButton = page.getByTestId("link-invite-copy")
  await expect(copyButton).toBeVisible({timeout: 10000})
  await expect(copyButton).toContainText("https://")
})
