import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

const DEFAULT_PUBLIC_CHAT_ID =
  "1d2f13b495d7425b70298a8acd375897a632562043d461e89b63499363eaf8e7"

async function ensurePublicChatsDisabled(page) {
  await page.goto("/settings/messages")
  const toggle = page.locator('input[type="checkbox"]').first()
  await expect(toggle).toBeVisible({timeout: 10000})
  if (await toggle.isChecked()) {
    await toggle.click()
  }
  await expect(toggle).not.toBeChecked()
}

test.describe("Public chat direct navigation", () => {
  test("opens a public chat even when public chats are disabled", async ({page}) => {
    test.setTimeout(60000)
    await signUp(page)
    await ensurePublicChatsDisabled(page)

    await page.goto(`/chats/${DEFAULT_PUBLIC_CHAT_ID}`)

    await expect(page.getByText("Public chat", {exact: true})).toBeVisible({
      timeout: 10000,
    })
  })
})
