import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("can navigate between main sections", async ({page}) => {
  await signUp(page)

  await page.getByRole("link", {name: "Search"}).click()
  await expect(page.url()).toContain("/u")

  await page.getByRole("link", {name: "About"}).click()
  await expect(page.url()).toContain("/about")

  await page.getByRole("link", {name: "Home", exact: true}).click()
  await expect(page).toHaveURL(/\/$/)
})
