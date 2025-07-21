import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test.describe("Post liking", () => {
  test("user can like a post", async ({page}) => {
    // First sign up
    await signUp(page)

    // Create a post to like
    await page.locator("#main-content").getByTestId("new-post-button").click()
    const postContent = "Test post for liking"
    await page.getByPlaceholder("What's on your mind?").fill(postContent)
    await page.getByRole("button", {name: "Publish"}).click()

    // Verify post is visible
    await expect(page.getByText(postContent)).toBeVisible({timeout: 10000})

    // Wait for the post to be fully loaded and like button to appear
    await page.waitForSelector('[data-testid="like-button"]', {timeout: 5000})

    // Find and click the like button
    const likeButton = page.getByTestId("like-button")
    await expect(likeButton).toBeVisible()
    await likeButton.click()

    // Verify like count increased and heart is filled
    await expect(page.getByTestId("like-count")).toHaveText("1")
    await expect(page.getByTestId("like-button")).toHaveClass(/text-error/)
  })
})
