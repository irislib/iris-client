import {test, expect} from "@playwright/test"

test("user can create a profile without a name", async ({page}) => {
  await page.goto("/")

  await page.getByRole("button", {name: "Create profile", exact: true}).first().click()

  const dialog = page.getByRole("dialog")
  await expect(
    dialog.getByRole("heading", {name: "Create profile", exact: true})
  ).toBeVisible()
  await dialog.getByRole("button", {name: "Create profile", exact: true}).click()

  await expect(dialog).not.toBeVisible()
  await expect(page.locator("#main-content").getByTestId("new-post-button")).toBeVisible()
})
