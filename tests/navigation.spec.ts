import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("can navigate between main sections", async ({page}) => {
  await signUp(page)

  await page.getByRole("link", {name: "Search"}).click()
  await expect(page.url()).toContain("/search")

  await page.getByRole("link", {name: "About"}).click()
  await expect(page.url()).toContain("/about")

  await page.getByRole("link", {name: "Home"}).click()
  await expect(page.url()).toMatch(/localhost:5173\/?$/)
})
