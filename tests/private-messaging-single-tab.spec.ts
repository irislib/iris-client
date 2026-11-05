import {expect, test} from "@playwright/test"
import {signUp} from "./auth.setup"

test("keeps the encrypted messaging runtime single-writer across tabs", async ({
  context,
  page,
}) => {
  await signUp(page)

  const secondPage = await context.newPage()
  await secondPage.goto("/settings/devices")
  await expect(
    secondPage
      .getByText("Private messaging is active in another tab", {exact: false})
      .first()
  ).toBeVisible({timeout: 15000})

  await page.close()
  // Closing the page resolves before Chromium necessarily releases its Web Lock.
  // Reload only once the original tab has relinquished the messaging runtime.
  await expect
    .poll(() =>
      secondPage.evaluate(async () => {
        const {held} = await navigator.locks.query()
        return held?.some((lock) => lock.name === "iris-private-messaging-runtime")
      })
    )
    .toBe(false)
  await secondPage.reload()
  await expect(
    secondPage.getByText("Private messaging is active in another tab", {exact: false})
  ).toHaveCount(0, {timeout: 15000})
  await expect(secondPage.getByRole("button", {name: "Link another device"})).toBeVisible(
    {timeout: 15000}
  )
})
