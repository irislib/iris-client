import {expect, test} from "@playwright/test"
import {signUp} from "./auth.setup"

test("keeps the encrypted messaging runtime single-writer across tabs", async ({
  context,
  page,
}) => {
  await signUp(page)

  const secondPage = await context.newPage()
  await secondPage.goto("/chats/new/devices")
  await expect(
    secondPage
      .getByText("Private messaging is active in another tab", {exact: false})
      .first()
  ).toBeVisible({timeout: 15000})

  await page.close()
  await secondPage.reload()
  await expect(
    secondPage.getByText("Private messaging is active in another tab", {exact: false})
  ).toHaveCount(0, {timeout: 15000})
  await expect(secondPage.getByRole("button", {name: "Link another device"})).toBeVisible(
    {timeout: 15000}
  )
})
