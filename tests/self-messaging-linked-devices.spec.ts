import {test, expect, type Page} from "@playwright/test"
import {signUp} from "./auth.setup"

async function openLoginDialog(page: Page) {
  await page.goto("/")
  await page.waitForLoadState("domcontentloaded")
  await expect(page.locator("#main-content")).toBeVisible({timeout: 10000})

  const signUpHeading = page.getByRole("heading", {name: "Sign up"})
  const signInHeading = page.getByRole("heading", {name: "Sign in"})

  if (
    (await signUpHeading.isVisible().catch(() => false)) ||
    (await signInHeading.isVisible().catch(() => false))
  ) {
    return
  }

  const signUpButton = page.locator("button:visible", {hasText: "Sign up"}).first()
  await expect(signUpButton).toBeVisible({timeout: 10000})
  await signUpButton.click()
}

async function waitForConnectedRelays(page: Page) {
  const relayIndicator = page.locator('[title*="relays connected"]').first()
  await expect(relayIndicator).toBeVisible({timeout: 10000})
  await expect
    .poll(
      async () => {
        const text = await relayIndicator.textContent()
        return parseInt(text?.match(/\d+/)?.[0] || "0", 10)
      },
      {timeout: 10000}
    )
    .toBeGreaterThan(0)
}

async function openSelfChat(page: Page) {
  const profileLink = page.locator('[data-testid="sidebar-user-row"]').first()
  await profileLink.click()
  await page.waitForLoadState("domcontentloaded")

  await expect(page.getByTestId("profile-header-actions")).toBeVisible({
    timeout: 10000,
  })

  const messageButton = page
    .getByTestId("profile-header-actions")
    .locator("button")
    .filter({has: page.locator('use[href*="mail-outline"]')})
    .first()
  await expect(messageButton).toBeVisible({timeout: 15000})
  await messageButton.click()
  await expect(page).toHaveURL(/\/chats\/chat/, {timeout: 15000})

  const messageInput = page.getByPlaceholder("Message").last()
  await expect(messageInput).toBeVisible({timeout: 30000})
  await expect(messageInput).toBeEnabled({timeout: 60000})
}

async function ensureCurrentDeviceRegistered(page: Page) {
  await page.goto("/chats/new/devices")
  await expect(page.getByRole("button", {name: "Link another device"})).toBeVisible({
    timeout: 10000,
  })

  const registerButton = page.getByRole("button", {name: "Register this device"})
  const thisDeviceBadge = page.locator("span.badge").filter({hasText: /^This device$/})

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
        await registerButton.click({timeout: 10000})

        const confirmDialog = page
          .locator("dialog[open]")
          .filter({has: page.getByRole("heading", {name: "Confirm Device Registration"})})

        await Promise.race([
          thisDeviceBadge.waitFor({state: "visible", timeout: 5000}),
          confirmDialog.waitFor({state: "visible", timeout: 5000}),
        ]).catch(() => {})

        if (await confirmDialog.isVisible().catch(() => false)) {
          await confirmDialog
            .getByRole("button", {name: "Register Device"})
            .click({timeout: 10000, force: true})
        }
      }
    }
  }

  await expect(thisDeviceBadge).toBeVisible({timeout: 20000})
}

test.describe("Self-messaging between linked devices", () => {
  test("syncs self DMs between owner device and linked sibling device", async ({
    browser,
  }) => {
    test.setTimeout(180000)

    const ownerContext = await browser.newContext()
    const linkedContext = await browser.newContext()

    const ownerPage = await ownerContext.newPage()
    const linkedPage = await linkedContext.newPage()

    try {
      await signUp(ownerPage)
      await ensureCurrentDeviceRegistered(ownerPage)

      await openLoginDialog(linkedPage)
      await linkedPage.getByRole("button", {name: "Link this device"}).click()

      const inviteButton = linkedPage.getByTestId("link-invite-copy")
      await expect(inviteButton).toBeVisible({timeout: 15000})
      const inviteUrl = await inviteButton.getAttribute("title")
      if (!inviteUrl) {
        throw new Error("Link invite URL missing from linked device flow")
      }

      await ownerPage.getByRole("button", {name: "Link another device"}).click()
      await expect(
        ownerPage.getByRole("heading", {name: "Link another device"})
      ).toBeVisible({
        timeout: 10000,
      })

      const inviteInput = ownerPage.getByPlaceholder("Paste link invite")
      await inviteInput.fill(inviteUrl)

      await expect(ownerPage.getByText("Device linked")).toBeVisible({timeout: 30000})
      const linkModal = ownerPage
        .locator('[role="dialog"], dialog')
        .filter({has: ownerPage.getByRole("heading", {name: "Link another device"})})
      await linkModal.getByRole("button", {name: "Close", exact: true}).click()
      await expect(linkModal).not.toBeVisible({timeout: 10000})

      await expect(linkedPage.locator("#main-content")).toBeVisible({timeout: 30000})
      await expect
        .poll(
          async () =>
            linkedPage.evaluate(() => {
              const raw = localStorage.getItem("user-storage")
              if (!raw) return null
              const parsed = JSON.parse(raw)
              return {
                publicKey: parsed?.state?.publicKey ?? null,
                linkedDevice: parsed?.state?.linkedDevice ?? false,
              }
            }),
          {timeout: 30000}
        )
        .toMatchObject({linkedDevice: true})

      await expect
        .poll(async () => ownerPage.locator("span.font-mono").count(), {timeout: 30000})
        .toBeGreaterThanOrEqual(2)

      await waitForConnectedRelays(ownerPage)
      await waitForConnectedRelays(linkedPage)

      await openSelfChat(ownerPage)
      await openSelfChat(linkedPage)

      const timestamp = Date.now()
      const ownerToLinked = `owner to linked ${timestamp}`
      const linkedToOwner = `linked to owner ${timestamp}`

      const ownerInput = ownerPage.getByPlaceholder("Message").last()
      await ownerInput.fill(ownerToLinked)
      await ownerInput.press("Enter")
      await expect(
        ownerPage.locator(".whitespace-pre-wrap").getByText(ownerToLinked).last()
      ).toBeVisible({timeout: 10000})

      await expect(
        linkedPage.locator(".whitespace-pre-wrap").getByText(ownerToLinked).last()
      ).toBeVisible({timeout: 60000})

      const linkedInput = linkedPage.getByPlaceholder("Message").last()
      await linkedInput.fill(linkedToOwner)
      await linkedInput.press("Enter")
      await expect(
        linkedPage.locator(".whitespace-pre-wrap").getByText(linkedToOwner).last()
      ).toBeVisible({timeout: 10000})

      await expect(
        ownerPage.locator(".whitespace-pre-wrap").getByText(linkedToOwner).last()
      ).toBeVisible({timeout: 60000})
    } finally {
      await ownerContext.close()
      await linkedContext.close()
    }
  })
})
