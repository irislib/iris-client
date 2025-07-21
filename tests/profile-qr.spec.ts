import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("can open QR code on own profile", async ({page}) => {
  // Login first
  await signUp(page)

  // Click on user avatar in sidebar to go to own profile
  await page.getByTestId("sidebar-user-row").locator("img").first().click()

  // Click QR code button in profile header
  await page.getByRole("button", {name: "Show QR Code"}).click()

  await expect(page.getByRole("img", {name: "QR Code"})).toBeVisible({timeout: 10000})

  const qrData = page.getByText(/nostr:npub/)
  await expect(qrData).toBeVisible({timeout: 10000})
})
