import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("can search for content", async ({page}) => {
  await signUp(page)

  const searchInput = page.getByPlaceholder("Search")
  await searchInput.fill("bitcoin")
  await searchInput.press("Enter")

  // Wait for navigation to complete
  await expect(page).toHaveURL(/\/search/, {timeout: 10000})
})
