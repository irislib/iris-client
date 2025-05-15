import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("user can create a post", async ({page}) => {
  await signUp(page)

  await page.locator("#main-content").getByTestId("new-post-button").click()
  const postContent = "Test post for basic functionality"
  await page.getByPlaceholder("What's on your mind?").fill(postContent)
  await page.getByRole("button", {name: "Publish"}).click()

  await expect(page.getByText(postContent)).toBeVisible()

  await page.getByRole("link", {name: "Home"}).click()
  await expect(page.getByText(postContent)).toBeVisible()
})
