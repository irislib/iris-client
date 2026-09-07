import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"
import {expectPersistedDraft} from "./utils/drafts"

test.describe("Note draft persistence", () => {
  test("should persist draft content between page reloads", async ({page}) => {
    await signUp(page)
    await page.locator("#main-content").getByTestId("new-post-button").click()
    const testContent = "This is a test draft that should persist"
    await page
      .getByRole("dialog")
      .getByPlaceholder("What's on your mind?")
      .fill(testContent)

    await page.keyboard.press("Escape")
    await expectPersistedDraft(page, testContent)

    await page.reload()
    await expect(
      page.locator("#main-content").getByTestId("new-post-button")
    ).toBeVisible({
      timeout: 15000,
    })
    await page.locator("#main-content").getByTestId("new-post-button").click()
    await expect(
      page.getByRole("dialog").getByPlaceholder("What's on your mind?")
    ).toHaveValue(testContent)
  })

  test("should clear draft after publishing", async ({page}) => {
    await signUp(page)
    await page.locator("#main-content").getByTestId("new-post-button").click()
    const testContent = "This is a test post that will be published"
    await page
      .getByRole("dialog")
      .getByPlaceholder("What's on your mind?")
      .fill(testContent)
    await expectPersistedDraft(page, testContent)

    await page.getByRole("dialog").getByRole("button", {name: "Post"}).click()

    await expect(
      page.getByRole("dialog").getByPlaceholder("What's on your mind?")
    ).not.toBeVisible()

    await expectPersistedDraft(page, testContent, false)

    await page.goto("/")
    const inlineDraft = page
      .locator("#main-content:visible")
      .getByPlaceholder("What's on your mind?")
      .first()
    await expect(inlineDraft).toBeVisible({timeout: 15000})
    await expect(inlineDraft).toHaveValue("")
  })
})
