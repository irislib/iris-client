import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"
import {ensureCurrentDeviceRegistered} from "./private-messaging-helpers"
import {usingBuiltDist} from "./utils/built-dist"

test.skip(usingBuiltDist, "requires local-relay private messaging device setup")

test("shows the current device key as npub in the devices list", async ({page}) => {
  test.setTimeout(60000)

  await signUp(page)
  await ensureCurrentDeviceRegistered(page)

  const thisDeviceBadge = page.locator("span.badge").filter({hasText: /^This device$/})
  await expect(thisDeviceBadge).toBeVisible({timeout: 20000})

  const currentDeviceEntry = page
    .locator('[data-testid="registered-device-entry"]')
    .filter({has: thisDeviceBadge})
    .first()
  await expect(currentDeviceEntry).toContainText(/npub1/i, {timeout: 10000})

  await page.screenshot({path: "/tmp/devices-current-npub.png", fullPage: true})
})
