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

    // Allow async draft persistence (localforage) to complete before reload.
    await page.waitForTimeout(1000)

    // Reload the page
    await page.reload()
    // Avoid networkidle (app uses persistent connections); wait for UI instead.
    await page.waitForLoadState("domcontentloaded")
    await expect(
      page.locator("#main-content").getByTestId("new-post-button")
    ).toBeVisible({
      timeout: 15000,
    })
    // Wait for draft store hydration after reload
    await page.waitForTimeout(2000)

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

    // Allow async draft persistence (localforage) to clear before navigating/reloading.
    await page.waitForTimeout(1000)

    // Go back to home to test draft from there
    await page.goto("/")
    // Avoid networkidle (app uses persistent connections); wait for UI instead.
    await page.waitForLoadState("domcontentloaded")

    // Verify the content is cleared in the inline creator on the home feed.
    const inlineDraft = page
      .locator("#main-content:visible")
      .getByPlaceholder("What's on your mind?")
      .first()
    await expect(inlineDraft).toBeVisible({timeout: 15000})
    await expect(inlineDraft).toHaveValue("")
  })
})
