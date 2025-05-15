import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("user can view post details", async ({page}) => {
  await signUp(page)

  await page.locator("#main-content").getByTestId("new-post-button").click()
  const postContent = "Test post for viewing details"
  await page.getByPlaceholder("What's on your mind?").fill(postContent)
  await page.getByRole("button", {name: "Publish"}).click()

  await expect(page.getByText(postContent)).toBeVisible()

  await page.getByText(postContent).click()

  await expect(page.url()).toContain("/note")

  await expect(page.getByText(postContent)).toBeVisible()
})
