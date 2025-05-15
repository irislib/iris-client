import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("can sign up with a username", async ({page}) => {
  const username = "Profile Test User"
  await signUp(page, username)

  await expect(page.url()).toMatch(/localhost:5173\/?$/)

  await expect(page.getByText(username, {exact: true})).toBeVisible()
})
