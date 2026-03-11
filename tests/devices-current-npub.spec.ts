import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("shows the current device key as npub in the devices list", async ({page}) => {
  test.setTimeout(60000)

  await signUp(page)
  await page.goto("/chats/new/devices")
  await expect(page.getByRole("button", {name: "Link another device"})).toBeVisible({
    timeout: 10000,
  })

  const registerButton = page.getByRole("button", {name: "Register this device"})
  const thisDeviceBadge = page.locator("span.badge").filter({hasText: /^This device$/})
  const confirmDialog = page
    .locator("dialog[open]")
    .filter({has: page.getByRole("heading", {name: "Confirm Device Registration"})})

  if (!(await thisDeviceBadge.isVisible().catch(() => false))) {
    if (await registerButton.isVisible({timeout: 2000}).catch(() => false)) {
      await Promise.race([
        thisDeviceBadge.waitFor({state: "visible", timeout: 3000}),
        registerButton.waitFor({state: "hidden", timeout: 3000}),
      ]).catch(() => {})

      if (
        !(await thisDeviceBadge.isVisible().catch(() => false)) &&
        (await registerButton.isVisible().catch(() => false))
      ) {
        await registerButton.click({timeout: 10000})

        await Promise.race([
          thisDeviceBadge.waitFor({state: "visible", timeout: 5000}),
          confirmDialog.waitFor({state: "visible", timeout: 5000}),
        ]).catch(() => {})

        if (await confirmDialog.isVisible().catch(() => false)) {
          await confirmDialog
            .getByRole("button", {name: "Register Device"})
            .click({timeout: 10000, force: true})
        }
      }
    }
  }

  await expect(thisDeviceBadge).toBeVisible({timeout: 20000})

  const currentDeviceKey = page.locator("span.font-mono").filter({hasText: /^npub1/i})
  await expect(currentDeviceKey.first()).toBeVisible({timeout: 10000})

  await page.screenshot({path: "/tmp/devices-current-npub.png", fullPage: true})
})
