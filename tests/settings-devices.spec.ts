import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test.describe("Settings devices", () => {
  test("lists devices section in settings and opens shared devices manager", async ({
    page,
  }) => {
    await signUp(page)

    await page.getByRole("link", {name: "Settings"}).click()
    await expect(page).toHaveURL(/\/settings$/)

    const devicesLink = page.getByRole("link", {name: "Devices"})
    await expect(devicesLink).toBeVisible({timeout: 10000})

    await devicesLink.click()
    await expect(page).toHaveURL(/\/settings\/devices$/)

    await expect(page.getByRole("button", {name: "Link another device"})).toBeVisible({
      timeout: 10000,
    })
  })
})
