import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test.describe("Note draft persistence", () => {
  test("should persist draft content between page reloads", async ({page}) => {
    // Sign up first
    await signUp(page)

    // Click new post button to open the note creator
    await page.locator("#main-content").getByTestId("new-post-button").click()

    // Type some content
    const testContent = "This is a test draft that should persist"
    await page
      .getByRole("dialog")
      .getByPlaceholder("What's on your mind?")
      .fill(testContent)

    // Close the note creator
    await page.keyboard.press("Escape")

    // Reload the page
    await page.reload()
    await page.waitForLoadState("networkidle")

    // Open note creator again
    await page.locator("#main-content").getByTestId("new-post-button").click()

    // Verify the content is still there
    await expect(
      page.getByRole("dialog").getByPlaceholder("What's on your mind?")
    ).toHaveValue(testContent)
  })

  test("should clear draft after publishing", async ({page}) => {
    // Sign up first
    await signUp(page)

    // Click new post button to open the note creator
    await page.locator("#main-content").getByTestId("new-post-button").click()

    // Type some content
    const testContent = "This is a test post that will be published"
    await page
      .getByRole("dialog")
      .getByPlaceholder("What's on your mind?")
      .fill(testContent)

    // Publish the post
    await page.getByRole("dialog").getByRole("button", {name: "Post"}).click()

    // Wait for the note creator to close
    await expect(
      page.getByRole("dialog").getByPlaceholder("What's on your mind?")
    ).not.toBeVisible()

    // Go back to home to test draft from there
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    // Open note creator again - use visible selector to avoid background stack views
    const newPostButton = page.locator(
      '#main-content:visible [data-testid="new-post-button"]'
    )
    await expect(newPostButton).toBeVisible({timeout: 10000})
    await newPostButton.click()

    // Verify the content is cleared
    await expect(
      page.getByRole("dialog").getByPlaceholder("What's on your mind?")
    ).toHaveValue("")
  })
})
