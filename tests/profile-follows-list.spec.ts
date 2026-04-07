import {expect, test} from "@playwright/test"
import {nip19} from "nostr-tools"
import {signUp} from "./auth.setup"

test("fresh viewer can open another user's follows list without following them first", async ({
  browser,
}) => {
  test.setTimeout(180000)

  const authorContext = await browser.newContext()
  const followeeOneContext = await browser.newContext()
  const followeeTwoContext = await browser.newContext()
  const viewerContext = await browser.newContext()

  const authorPage = await authorContext.newPage()
  const followeeOnePage = await followeeOneContext.newPage()
  const followeeTwoPage = await followeeTwoContext.newPage()
  const viewerPage = await viewerContext.newPage()

  const getProfilePath = (publicKey: string | null) => {
    if (!publicKey) {
      throw new Error("Expected signup to return a public key")
    }
    return `/${nip19.npubEncode(publicKey)}`
  }

  const followUser = async (page: typeof authorPage, profilePath: string) => {
    await page.goto(profilePath)
    const followButton = page
      .getByTestId("profile-header-actions")
      .getByRole("button", {name: "Follow"})
    await expect(followButton).toBeVisible({timeout: 15000})
    await followButton.click()
    await page.mouse.move(0, 0)
    await expect(followButton.locator("span.absolute")).toHaveText("Following", {
      timeout: 15000,
    })
  }

  try {
    const author = await signUp(authorPage, "Author User")
    const followeeOne = await signUp(followeeOnePage, "Followee One")
    const followeeTwo = await signUp(followeeTwoPage, "Followee Two")

    await followUser(authorPage, getProfilePath(followeeOne.publicKey))
    await followUser(authorPage, getProfilePath(followeeTwo.publicKey))

    await authorPage.goto(getProfilePath(author.publicKey))
    await expect(authorPage.getByRole("button", {name: /2 follows/i})).toBeVisible({
      timeout: 20000,
    })

    await signUp(viewerPage, "Fresh Viewer")
    await viewerPage.goto(getProfilePath(author.publicKey))

    const followsButton = viewerPage.getByRole("button", {name: /2 follows/i})
    await expect(followsButton).toBeVisible({timeout: 20000})
    await followsButton.click()

    const modal = viewerPage.locator("dialog.modal")
    await expect(modal).toBeVisible({timeout: 10000})
    await expect(modal.locator('[data-testid="sidebar-user-row"]')).toHaveCount(2, {
      timeout: 60000,
    })
    await expect(modal.getByText("Followee One", {exact: true})).toBeVisible({
      timeout: 60000,
    })
    await expect(modal.getByText("Followee Two", {exact: true})).toBeVisible({
      timeout: 60000,
    })
  } finally {
    await authorContext.close()
    await followeeOneContext.close()
    await followeeTwoContext.close()
    await viewerContext.close()
  }
})
