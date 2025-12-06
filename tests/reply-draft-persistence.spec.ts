import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test.describe("Reply draft persistence", () => {
  test("should persist reply draft after page reload", async ({page}) => {
    // Sign up first
    await signUp(page)

    // Create a post to reply to
    await page.locator("#main-content").getByTestId("new-post-button").click()
    await page
      .getByRole("dialog")
      .getByPlaceholder("What's on your mind?")
      .fill("Post to reply to")
    await page.getByRole("dialog").getByRole("button", {name: "Post"}).click()

    // Wait for navigation to post detail page
    await page.waitForURL(/\/note/, {timeout: 10000})

    // Wait for FeedItem to render
    await page.waitForLoadState("networkidle")

    // Wait for feed-item to appear
    const feedItem = page
      .getByTestId("feed-item")
      .filter({hasText: "Post to reply to"})
      .first()
    await expect(feedItem).toBeVisible({timeout: 10000})

    // Type a draft reply
    const replyDraft = "This is my draft reply that should persist"
    await page.getByPlaceholder("Write your reply...").fill(replyDraft)

    // Wait for draft to persist to localforage
    await page.waitForTimeout(1000)

    // Reload the page
    await page.reload()
    await page.waitForLoadState("networkidle")

    // Wait for the feed item to load first (ensures draft store is hydrated)
    await expect(
      page.getByTestId("feed-item").filter({hasText: "Post to reply to"}).first()
    ).toBeVisible({timeout: 15000})

    // Wait for draft store to hydrate from localforage
    await page.waitForTimeout(2000)

    // Check that reply draft is preserved
    await expect(page.getByPlaceholder("Write your reply...")).toHaveValue(replyDraft, {
      timeout: 15000,
    })
  })

  test.skip("should keep main draft separate from reply drafts", async ({page}) => {
    // Sign up first
    await signUp(page)

    // Create a main draft
    await page.locator("#main-content").getByTestId("new-post-button").click()
    const mainDraft = "This is the main draft content"
    await page
      .getByRole("dialog")
      .getByPlaceholder("What's on your mind?")
      .fill(mainDraft)
    await page.keyboard.press("Escape")

    // Create a post to reply to (publish a different post first)
    await page.locator("#main-content").getByTestId("new-post-button").click()
    // The main draft should still be there, clear it and write new post
    await page.getByRole("dialog").getByPlaceholder("What's on your mind?").clear()
    await page
      .getByRole("dialog")
      .getByPlaceholder("What's on your mind?")
      .fill("Post to reply to")
    await page.getByRole("dialog").getByRole("button", {name: "Post"}).click()

    // Wait for navigation and get the note URL
    await page.waitForURL(/\/note/, {timeout: 10000})
    const noteUrl = page.url()

    // Navigate back to home to create main draft
    await page.goto("/")

    // Create the main draft
    await page.locator("#main-content").getByTestId("new-post-button").click()
    await page
      .getByRole("dialog")
      .getByPlaceholder("What's on your mind?")
      .fill(mainDraft)
    await page.keyboard.press("Escape")

    // Navigate back to the post we created
    await page.goto(noteUrl)
    // Wait for feed item to load (may take time to fetch from relay)
    await expect(
      page.getByTestId("feed-item").filter({hasText: "Post to reply to"}).first()
    ).toBeVisible({timeout: 20000})
    const replyDraft = "This is a reply draft"
    await page.getByPlaceholder("Write your reply...").fill(replyDraft)

    // Reload the page
    await page.reload()
    await page.waitForLoadState("networkidle")

    // Check that main draft is still there
    await page.locator("#main-content").getByTestId("new-post-button").click()
    await expect(
      page.getByRole("dialog").getByPlaceholder("What's on your mind?")
    ).toHaveValue(mainDraft)
    await page.keyboard.press("Escape")

    // Check that reply draft is still there
    await page
      .getByTestId("feed-item")
      .filter({hasText: "Post to reply to"})
      .first()
      .click()
    await page.waitForURL(/\/note/)
    // Wait for post to load and draft to hydrate
    await expect(
      page.getByTestId("feed-item").filter({hasText: "Post to reply to"}).first()
    ).toBeVisible({timeout: 15000})
    await page.waitForTimeout(2000)
    await expect(page.getByPlaceholder("Write your reply...")).toHaveValue(replyDraft, {
      timeout: 10000,
    })
  })

  test("should clear reply draft after publishing reply", async ({page}) => {
    // Sign up first
    await signUp(page)

    // Create a post to reply to
    await page.locator("#main-content").getByTestId("new-post-button").click()
    await page
      .getByRole("dialog")
      .getByPlaceholder("What's on your mind?")
      .fill("Post to reply to")
    await page.getByRole("dialog").getByRole("button", {name: "Post"}).click()

    // Wait for navigation to post detail page - already there after publish
    await page.waitForURL(/\/note/, {timeout: 10000})
    await page.waitForLoadState("networkidle")

    // Wait for feed-item to render with reply input
    const feedItem = page
      .getByTestId("feed-item")
      .filter({hasText: "Post to reply to"})
      .first()
    await expect(feedItem).toBeVisible({timeout: 10000})

    // Type and publish reply
    const replyContent = "This reply will be published"
    await page.getByPlaceholder("Write your reply...").fill(replyContent)
    await page.getByRole("button", {name: "Reply"}).click()
    await page.waitForTimeout(1000)

    // Check reply draft is cleared
    await expect(page.getByPlaceholder("Write your reply...")).toHaveValue("")
  })
})
