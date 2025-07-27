import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("user can create a post", async ({page}) => {
  await signUp(page)

  await page.locator("#main-content").getByTestId("new-post-button").click()
  const postContent = "Test post for basic functionality"
  await page.getByPlaceholder("What's on your mind?").fill(postContent)
  await page.getByRole("button", {name: "Publish"}).click()

  // Verify post is visible in the feed (use nth(1) to skip the textarea and get the published post)
  await expect(page.getByText(postContent).nth(1)).toBeVisible()

  await page.getByRole("link", {name: "Home", exact: true}).click()
  // After navigation, the post should still be visible in the feed
  await expect(page.getByText(postContent)).toBeVisible()
})
