import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("can search for content", async ({page}) => {
  await signUp(page)

  const searchInput = page.getByPlaceholder("Search")
  await searchInput.fill("bitcoin")
  await searchInput.press("Enter")

  await expect(page.url()).toContain("/search")

  await page.waitForLoadState("networkidle")

  await expect(page.url()).toContain("/search")
})
