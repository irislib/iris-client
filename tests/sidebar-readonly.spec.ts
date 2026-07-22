import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("shows read-only status above the viewed account in the sidebar", async ({page}) => {
  const targetNpub = "npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk"
  await signUp(page, targetNpub)

  const sidebar = page.getByTestId("desktop-sidebar")
  const indicator = sidebar.getByTestId("sidebar-readonly-indicator")
  const userRow = sidebar.getByTestId("sidebar-user-row")
  await expect(indicator).toBeVisible()
  await expect(userRow).toBeVisible()

  const indicatorBox = await indicator.boundingBox()
  const userBox = await userRow.boundingBox()
  expect(indicatorBox).not.toBeNull()
  expect(userBox).not.toBeNull()
  expect(indicatorBox!.y + indicatorBox!.height).toBeLessThanOrEqual(userBox!.y)
})
