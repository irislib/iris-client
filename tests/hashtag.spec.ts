import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("can view trending content", async ({page}) => {
  await signUp(page)

  await page.goto("/")

  await page.waitForLoadState("networkidle")

  await expect(page.getByText("TRENDING", {exact: false})).toBeVisible({timeout: 10000})
})
