import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("notification advanced settings are collapsed under Notifications", async ({
  page,
}) => {
  await signUp(page)

  await page.goto("/settings/notifications")
  await page.waitForLoadState("domcontentloaded")

  // Basic notification preferences should be visible.
  await expect(page.getByText("Mentions", {exact: true})).toBeVisible()

  // Advanced notification settings should be hidden until expanded.
  await expect(page.getByText("Notification Server", {exact: true})).toBeHidden()

  await page.getByRole("button", {name: "Advanced"}).click()

  await expect(page.getByText("Notification Server", {exact: true})).toBeVisible()
})
