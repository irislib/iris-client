import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("can navigate to About page", async ({page}) => {
  await signUp(page)

  await page.getByRole("link", {name: "About"}).click()

  await expect(page.url()).toContain("/about")

  await expect(page.url()).toContain("/about")
})
