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

    // Verify post is visible in the feed (use nth(1) to skip the textarea and get the published post)
    await expect(page.getByText(postContent).nth(1)).toBeVisible({timeout: 10000})

    // Find our specific post by text and then find the like button within its feed item
    const ourPost = page
      .locator('[data-testid="feed-item"]')
      .filter({hasText: postContent})
      .first()
    const likeButton = ourPost.getByTestId("like-button")
    await expect(likeButton).toBeVisible({timeout: 5000})
    await likeButton.click()

    // Verify like count increased and heart is filled for our specific post
    await expect(ourPost.getByTestId("like-count")).toHaveText("1")
    await expect(ourPost.getByTestId("like-button")).toHaveClass(/text-error/)
  })
})
