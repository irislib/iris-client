import {test, expect} from "@playwright/test"
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  type EventTemplate,
} from "nostr-tools"
import {signIn, signUp} from "./auth.setup"
import {ensureCurrentDeviceRegistered} from "./private-messaging-helpers"
import {usingBuiltDist} from "./utils/built-dist"

test.skip(usingBuiltDist, "requires local-relay private messaging device setup")

for (const viewport of [
  {name: "desktop", width: 1280, height: 800},
  {name: "mobile", width: 390, height: 844},
]) {
  test(`${viewport.name}: registration is required and continues to the intended chat`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90000)
    await page.setViewportSize(viewport)
    const secret = generateSecretKey()
    const publicKey = getPublicKey(secret)
    await signUp(page, nip19.nsecEncode(secret))

    for (const path of ["/chats", "/chats/new", "/chats/new/group"]) {
      await page.goto(path)
      await expect(page.getByRole("heading", {name: "Set up chats"})).toBeVisible()
      await expect(
        page.getByRole("button", {name: "Register this device", exact: true})
      ).toBeEnabled({timeout: 15000})
      await expect(page.getByRole("link", {name: "New Chat", exact: true})).toBeHidden()
      await expect(
        page.getByPlaceholder("Search users, paste npub or chat invite link")
      ).toBeHidden()
      await expect(page.getByRole("button", {name: /Next/})).toBeHidden()
    }

    await page.goto(`/${nip19.npubEncode(publicKey)}`)
    await page
      .getByTestId("profile-header-actions")
      .locator("button.btn-circle")
      .first()
      .click()
    await expect(page).toHaveURL(/\/chats\/chat$/)
    await expect(page.getByRole("heading", {name: "Set up chats"})).toBeVisible()
    await expect(page.getByPlaceholder("Message")).toBeHidden()
    await page.screenshot({
      path: testInfo.outputPath(`${viewport.name}-registration.png`),
    })

    await page.getByRole("button", {name: "Register this device", exact: true}).click()
    const messageInput = page.getByPlaceholder("Message").last()
    await expect(messageInput).toBeEnabled({timeout: 30000})
    await expect(page).toHaveURL(/\/chats\/chat$/)
    await messageInput.fill("Ready to chat on this device")
    await messageInput.press("Enter")
    await expect(
      page
        .locator(".whitespace-pre-wrap")
        .getByText("Ready to chat on this device")
        .last()
    ).toBeVisible()

    await page.goto("/chats/new")
    await expect(
      page.getByPlaceholder("Search users, paste npub or chat invite link").last()
    ).toBeVisible({timeout: 15000})
    await expect(page.getByRole("heading", {name: "Set up chats"})).toBeHidden()
  })
}

test("another registered device does not bypass setup; confirmation can be cancelled and retried", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(90000)
  const owner = await signUp(page)
  await ensureCurrentDeviceRegistered(page)
  const otherContext = await browser.newContext()
  try {
    const otherPage = await otherContext.newPage()
    await signIn(otherPage, owner.privateKey)
    await otherPage.goto("/chats/new/group")
    await expect(otherPage.getByRole("heading", {name: "Set up chats"})).toBeVisible()
    const register = otherPage.getByRole("button", {
      name: "Register this device",
      exact: true,
    })
    await expect(register).toBeEnabled({timeout: 15000})
    await register.click()
    const dialog = otherPage.locator("dialog[open]")
    await expect(dialog).toBeVisible({timeout: 15000})
    await dialog.getByRole("button", {name: "Cancel", exact: true}).click()
    await expect(dialog).toBeHidden()
    await expect(otherPage.getByRole("heading", {name: "Set up chats"})).toBeVisible()
    await register.click()
    await expect(dialog).toBeVisible({timeout: 15000})
    await otherPage.screenshot({
      path: testInfo.outputPath("registration-confirmation.png"),
    })
    await dialog.getByRole("button", {name: "Register Device", exact: true}).click()
    await expect(otherPage.getByRole("button", {name: /Next/})).toBeEnabled({
      timeout: 30000,
    })
    await expect(otherPage).toHaveURL(/\/chats\/new\/group$/)
  } finally {
    await otherContext.close()
  }
})

test("read-only accounts get a sign-in action instead of a setup spinner", async ({
  page,
}) => {
  await signUp(page, nip19.npubEncode(getPublicKey(generateSecretKey())))
  await page.goto("/chats")
  await expect(page.getByRole("heading", {name: "Sign in to use chats"})).toBeVisible()
  await page.getByRole("button", {name: "Sign in", exact: true}).click()
  await expect(page.getByRole("heading", {name: "Sign in", exact: true})).toBeVisible()
})

test("a rejected registration stays gated and can be retried", async ({page}) => {
  test.setTimeout(60000)
  const secret = generateSecretKey()
  const publicKey = getPublicKey(secret)
  let rejectRegistration = true
  await page.exposeFunction("signRegistrationTestEvent", (event: EventTemplate) => {
    if (event.kind === 37368 && rejectRegistration) {
      throw new Error("User rejected signature")
    }
    return finalizeEvent(event, secret)
  })
  await page.addInitScript((ownerPubkey) => {
    window.nostr = {
      getPublicKey: async () => ownerPubkey,
      signEvent: (event) =>
        (
          window as unknown as {
            signRegistrationTestEvent: (
              event: unknown
            ) => Promise<ReturnType<typeof finalizeEvent>>
          }
        ).signRegistrationTestEvent(event),
    }
  }, publicKey)
  await page.goto("/chats")
  await page.getByRole("button", {name: "Sign in", exact: true}).click()
  await page.getByRole("button", {name: "Nostr Extension Login"}).click()
  await expect(page.locator("dialog[open]")).toBeHidden()
  const register = page.getByRole("button", {name: "Register this device", exact: true})
  await expect(register).toBeEnabled({timeout: 15000})
  await register.click()
  await expect(page.getByRole("alert")).toHaveText(
    "Couldn’t register this device. Please try again.",
    {timeout: 15000}
  )
  await expect(page.getByRole("link", {name: "New Chat", exact: true})).toBeHidden()

  rejectRegistration = false
  await register.click()
  await expect(page.getByRole("link", {name: "New Chat", exact: true})).toBeVisible({
    timeout: 15000,
  })
  await expect(page.getByRole("alert")).toBeHidden()
})

test("another tab explains how to recover instead of offering registration", async ({
  page,
  context,
}) => {
  test.setTimeout(60000)
  await signUp(page)
  await ensureCurrentDeviceRegistered(page)
  const otherTab = await context.newPage()
  await otherTab.goto("/chats")
  await expect(
    otherTab.getByRole("heading", {name: "Chats is open in another tab"})
  ).toBeVisible()
  await expect(
    otherTab.getByRole("button", {name: "Register this device", exact: true})
  ).toBeHidden()
  await page.close()
  await otherTab.getByRole("button", {name: "Reload", exact: true}).click()
  await expect(otherTab.getByRole("link", {name: "New Chat", exact: true})).toBeVisible({
    timeout: 15000,
  })
})
