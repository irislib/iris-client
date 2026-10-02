import {expect, test} from "@playwright/test"
import {signUp} from "./auth.setup"

test("following relay hints is opt-in and the preference survives reloads", async ({
  page,
}) => {
  await signUp(page, "Relay preferences")
  await page.goto("/settings/network")
  const toggle = page.getByRole("checkbox", {name: "Follow relay hints", exact: true})
  await expect(toggle).not.toBeChecked()
  await Promise.all([page.waitForEvent("load"), toggle.check()])
  await expect(toggle).toBeChecked()
  await page.reload()
  await expect(toggle).toBeChecked()
  await Promise.all([page.waitForEvent("load"), toggle.uncheck()])
  await expect(toggle).not.toBeChecked()
  await page.reload()
  await expect(toggle).not.toBeChecked()
})
