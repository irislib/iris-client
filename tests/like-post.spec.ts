import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test.describe("Post liking", () => {
  test("user can like a post", async ({page}) => {
    // First sign up
    await signUp(page)

    // Create a post to like
    await page.locator("#main-content").getByTestId("new-post-button").click()
    const postContent = "Test post for liking"
    await page
      .getByRole("dialog")
      .getByPlaceholder("What's on your mind?")
      .fill(postContent)
    await page.getByRole("dialog").getByRole("button", {name: "Post"}).click()

    // Verify post is visible
    await expect(page.getByText(postContent).first()).toBeVisible({timeout: 10000})

    // Find the feed item containing our post text
    const postElement = page
      .getByTestId("feed-item")
      .filter({hasText: postContent})
      .first()

    // Wait for the like button within this specific post
    const likeButton = postElement.getByTestId("like-button")
    await expect(likeButton).toBeVisible({timeout: 5000})
    await likeButton.click()

    // Verify like count increased and heart is filled
    await expect(postElement.getByTestId("like-count")).toHaveText("1")
    await expect(likeButton).toHaveClass(/text-error/)
  })
})
