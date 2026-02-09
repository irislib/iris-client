import {test, expect, type Page} from "@playwright/test"
import {signUp} from "./auth.setup"
import {nip19} from "nostr-tools"

async function ensureDeviceRegistered(page: Page) {
  // Navigate to Chats and register device first (required for private messaging)
  await page.getByRole("link", {name: "Chats"}).click()

  // Go to Devices tab and register this device
  await page.getByRole("link", {name: "Devices"}).click()
  await expect(page).toHaveURL(/\/chats\/new\/devices/)
  await expect(page.getByRole("button", {name: "Link another device"})).toBeVisible({
    timeout: 10000,
  })

  const registerButton = page.getByRole("button", {name: "Register this device"})
  const thisDeviceBadge = page.getByText("This device").first()

  if (!(await thisDeviceBadge.isVisible().catch(() => false))) {
    if (await registerButton.isVisible({timeout: 2000}).catch(() => false)) {
      // The devices store starts out empty, so the register button can appear briefly even when
      // the current device is already registered. Give it a moment to settle before clicking.
      await Promise.race([
        thisDeviceBadge.waitFor({state: "visible", timeout: 3000}),
        registerButton.waitFor({state: "hidden", timeout: 3000}),
      ]).catch(() => {})

      if (
        !(await thisDeviceBadge.isVisible().catch(() => false)) &&
        (await registerButton.isVisible().catch(() => false))
      ) {
        await registerButton.click({timeout: 10000})

        // If there are existing devices, registration requires confirmation.
        const confirmHeading = page.getByRole("heading", {
          name: "Confirm Device Registration",
        })
        if (await confirmHeading.isVisible({timeout: 2000}).catch(() => false)) {
          await page.getByRole("button", {name: "Register Device"}).click({
            timeout: 10000,
          })
        }

        await expect(thisDeviceBadge).toBeVisible({timeout: 20000})
        await expect(registerButton).not.toBeVisible({timeout: 20000})
      }
    }
  }
}

async function openChatFromProfile(page: Page, targetPubkeyHex: string) {
  const targetNpub = nip19.npubEncode(targetPubkeyHex)

  await page.goto(`/${targetNpub}`)
  await page.waitForLoadState("domcontentloaded")

  // Wait for profile to load (and AppKeys subscription to detect invites).
  await expect(page.getByTestId("profile-header-actions")).toBeVisible({timeout: 15000})

  const messageButton = page
    .getByTestId("profile-header-actions")
    .locator("button")
    .filter({has: page.locator('use[href*="mail-outline"]')})
    .first()
  await expect(messageButton).toBeVisible({timeout: 30000})

  await messageButton.click()
  await expect(page).toHaveURL(/\/chats\/chat/, {timeout: 15000})

  const messageInput = page.getByPlaceholder("Message").last()
  await expect(messageInput).toBeVisible({timeout: 15000})
  await expect(messageInput).toBeEnabled({timeout: 60000})
}

test.describe("Group admin edits", () => {
  test("group admins can edit metadata + members; non-admins cannot", async ({
    browser,
  }) => {
    test.setTimeout(180000)

    const contextA = await browser.newContext()
    const contextB = await browser.newContext()

    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    try {
      const admin = await signUp(pageA, "Admin User")
      const member = await signUp(pageB, "Member User")
      if (!admin.publicKey) throw new Error("Expected admin publicKey from signup")
      if (!member.publicKey) throw new Error("Expected member publicKey from signup")

      await ensureDeviceRegistered(pageA)
      await ensureDeviceRegistered(pageB)

      // Establish a DM session first so group fanout to the member has an active channel.
      await openChatFromProfile(pageA, member.publicKey)
      const dmMessage = `hello ${Date.now()}`
      const adminInput = pageA.getByPlaceholder("Message").last()
      await adminInput.fill(dmMessage)
      await adminInput.press("Enter")

      await openChatFromProfile(pageB, admin.publicKey)
      await expect(
        pageB.locator(".whitespace-pre-wrap").getByText(dmMessage)
      ).toBeVisible({
        timeout: 60000,
      })

      // Admin: create group with self only.
      await pageA.goto("/chats/new/group")
      await pageA.getByRole("button", {name: /Next/}).click()
      await pageA.getByPlaceholder("Enter group name").fill("Test Group")
      await pageA.getByRole("button", {name: "Create Group"}).click()
      await expect(pageA).toHaveURL(/\/chats\/group\//, {timeout: 15000})

      const url = pageA.url()
      const match = url.match(/\/chats\/group\/([^/]+)/)
      if (!match?.[1]) throw new Error(`Could not parse group id from url: ${url}`)
      const groupId = match[1]

      // Admin: edit group metadata + add member.
      await pageA.goto(`/chats/group/${groupId}/details`)
      await expect(pageA.getByText("Group Details")).toBeVisible({timeout: 15000})

      await expect(pageA.locator(".badge").getByText("Admin").first()).toBeVisible({
        timeout: 15000,
      })
      await pageA.getByRole("button", {name: "Edit group"}).click()

      await pageA.getByPlaceholder("Enter group name").fill("Renamed Group")
      await pageA.getByPlaceholder("Enter group description").fill("Updated description")

      await pageA.getByPlaceholder(/npub|hex/i).fill(member.publicKey)
      await pageA.getByRole("button", {name: "Add member"}).click()
      await expect(pageA.getByRole("button", {name: "×"}).first()).toBeVisible({
        timeout: 15000,
      })

      await pageA.getByRole("button", {name: "Save changes"}).click()
      await expect(pageA.getByText("Renamed Group").first()).toBeVisible({timeout: 15000})

      // Member: should receive the group, see admin badge, but not be able to edit.
      await pageB.goto(`/chats/group/${groupId}/details`, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      })
      await expect(pageB.getByText("Group Details")).toBeVisible({timeout: 60000})
      await expect(pageB.getByText("Renamed Group").first()).toBeVisible({timeout: 60000})
      await expect(pageB.locator(".badge").getByText("Admin").first()).toBeVisible({
        timeout: 15000,
      })
      await expect(pageB.getByRole("button", {name: "Edit group"})).not.toBeVisible()
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })
})
