import {expect, type Page} from "@playwright/test"

async function waitForNextCreatedAtSecond() {
  const currentSecond = Math.floor(Date.now() / 1000)
  while (Math.floor(Date.now() / 1000) === currentSecond) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

function registeredDeviceEntries(page: Page) {
  return page.locator('[data-testid="registered-device-entry"]:visible')
}

export async function ensureCurrentDeviceRegistered(page: Page): Promise<void> {
  await page.goto("/chats/new/devices")
  await expect(page).toHaveURL(/\/chats\/new\/devices/)
  await expect(page.getByRole("button", {name: "Link another device"})).toBeVisible({
    timeout: 10000,
  })

  const initialDeviceCount = await registeredDeviceEntries(page).count()
  const registerButton = page.getByRole("button", {name: "Register this device"}).first()
  const thisDeviceBadge = page
    .locator("span.badge:visible")
    .filter({hasText: /^This device$/})
    .first()

  if (!(await thisDeviceBadge.isVisible().catch(() => false))) {
    if (await registerButton.isVisible({timeout: 2000}).catch(() => false)) {
      await Promise.race([
        thisDeviceBadge.waitFor({state: "visible", timeout: 3000}),
        registerButton.waitFor({state: "hidden", timeout: 3000}),
      ]).catch(() => {})

      if (
        !(await thisDeviceBadge.isVisible().catch(() => false)) &&
        (await registerButton.isVisible().catch(() => false))
      ) {
        await waitForNextCreatedAtSecond()
        await registerButton.scrollIntoViewIfNeeded().catch(() => {})
        await registerButton.click({
          timeout: 10000,
          force: true,
        })

        if (initialDeviceCount > 0) {
          const confirmDialog = page.locator("dialog.modal[open]").first()
          await expect(confirmDialog).toBeVisible({timeout: 15000})
          const confirmButton = confirmDialog.getByRole("button", {
            name: "Register Device",
          })
          await confirmButton.scrollIntoViewIfNeeded().catch(() => {})
          await confirmButton.click({
            timeout: 10000,
            force: true,
          })
        }

        await expect
          .poll(
            async () =>
              (await registeredDeviceEntries(page).count()) > initialDeviceCount ||
              (await thisDeviceBadge.isVisible().catch(() => false)),
            {
              timeout: 30000,
            }
          )
          .toBe(true)
      }
    }
  }

  await expect(thisDeviceBadge).toBeVisible({timeout: 30000})
}

export async function acceptMessageRequestIfPresent(page: Page): Promise<void> {
  const acceptButton = page.getByRole("button", {name: "Accept"})
  if (await acceptButton.isVisible({timeout: 1000}).catch(() => false)) {
    await acceptButton.click()
    await expect(acceptButton).not.toBeVisible({timeout: 15000})
  }
}

export async function expectDmMessageInputEnabled(page: Page) {
  const messageInput = page.getByPlaceholder("Message").last()
  await expect(messageInput).toBeVisible({timeout: 30000})
  await acceptMessageRequestIfPresent(page)
  await expect(messageInput).toBeEnabled({timeout: 60000})
  return messageInput
}
