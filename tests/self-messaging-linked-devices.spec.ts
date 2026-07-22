import {test, expect, type Page} from "@playwright/test"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"
import {waitForConnectedRelays} from "./utils/relay-status"
import {nip19} from "nostr-tools"
import {expectDmMessageInputEnabled} from "./private-messaging-helpers"

test.skip(usingBuiltDist, "requires local-relay linked-device private messaging")

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

async function openChat(page: Page, targetPubkey?: string) {
  if (targetPubkey) {
    await page.goto(`/${nip19.npubEncode(targetPubkey)}`)
  } else {
    await page.locator('[data-testid="sidebar-user-row"]').first().click()
  }
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

  await expectDmMessageInputEnabled(page)
}

async function waitForNextCreatedAtSecond(): Promise<void> {
  const currentSecond = Math.floor(Date.now() / 1000)
  while (Math.floor(Date.now() / 1000) === currentSecond) {
    await pageWait(25)
  }
}

function pageWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  test("syncs self and peer DMs, then logs out a revoked linked sibling", async ({
    browser,
  }) => {
    test.setTimeout(180000)

    const ownerContext = await browser.newContext()
    const linkedContext = await browser.newContext()
    const peerContext = await browser.newContext()

    const ownerPage = await ownerContext.newPage()
    const linkedPage = await linkedContext.newPage()
    const peerPage = await peerContext.newPage()

    try {
      const owner = await signUp(ownerPage)
      if (!owner.publicKey) throw new Error("Expected owner public key")
      await ensureCurrentDeviceRegistered(ownerPage)
      const peer = await signUp(peerPage)
      if (!peer.publicKey) throw new Error("Expected peer public key")
      await ensureCurrentDeviceRegistered(peerPage)

      await openLoginDialog(linkedPage)
      await linkedPage.getByRole("button", {name: "Link this device"}).click()

      const inviteButton = linkedPage.getByTestId("link-invite-copy")
      await expect(inviteButton).toBeVisible({timeout: 15000})
      const inviteUrl = await inviteButton.getAttribute("title")
      if (!inviteUrl) {
        throw new Error("Link invite URL missing from linked device flow")
      }

      await waitForNextCreatedAtSecond()
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

      await openChat(ownerPage)
      await openChat(linkedPage)

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

      const ownerToPeer = `owner to external peer ${timestamp}`
      await openChat(ownerPage, peer.publicKey)
      const ownerPeerInput = ownerPage.getByPlaceholder("Message").last()
      await expect(ownerPeerInput).toBeEnabled({timeout: 60000})
      await ownerPeerInput.fill(ownerToPeer)
      await ownerPeerInput.press("Enter")

      await openChat(linkedPage, peer.publicKey)
      await expect(
        linkedPage.locator(".whitespace-pre-wrap").getByText(ownerToPeer).last()
      ).toBeVisible({timeout: 60000})

      await openChat(peerPage, owner.publicKey)
      await expect(
        peerPage.locator(".whitespace-pre-wrap").getByText(ownerToPeer).last()
      ).toBeVisible({timeout: 60000})

      await linkedPage.evaluate(() => {
        localStorage.setItem("cashu:seed", "wallet-seed-sentinel")
      })
      await ownerPage.goto("/chats/new/devices")
      const revokeLinkedDevice = ownerPage.getByTitle("Revoke device").first()
      await expect(revokeLinkedDevice).toBeVisible({timeout: 30000})
      await revokeLinkedDevice.click()

      const revokeDialog = ownerPage.locator("dialog[open]").filter({
        has: ownerPage.getByRole("heading", {name: "Confirm Device Revocation"}),
      })
      await expect(revokeDialog).toBeVisible({timeout: 10000})
      await revokeDialog.getByRole("button", {name: "Revoke Device"}).click()

      await expect
        .poll(
          () =>
            linkedPage
              .evaluate(() => {
                const raw = localStorage.getItem("user-storage")
                if (!raw) return {publicKey: "", linkedDevice: false}
                const state = JSON.parse(raw)?.state
                return {
                  publicKey: state?.publicKey ?? "",
                  linkedDevice: state?.linkedDevice ?? false,
                }
              })
              .catch(() => ({publicKey: "reloading", linkedDevice: true})),
          {timeout: 60000}
        )
        .toEqual({publicKey: "", linkedDevice: false})
      await expect
        .poll(() => linkedPage.evaluate(() => localStorage.getItem("cashu:seed")))
        .toBe("wallet-seed-sentinel")
    } finally {
      await ownerContext.close()
      await linkedContext.close()
      await peerContext.close()
    }
  })
})
