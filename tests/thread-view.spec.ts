import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("can sign up and see home feed", async ({page}) => {
  const username = "Thread Test User"
  await signUp(page, username)

  await expect(page.url()).toMatch(/localhost:5173\/?$/)

  await expect(page.locator("#main-content").getByTestId("new-post-button")).toBeVisible()

  await expect(page.getByText(username, {exact: true})).toBeVisible()
})
