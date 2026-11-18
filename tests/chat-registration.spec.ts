import type {Page} from "@playwright/test"
import {test, expect} from "./fixtures/isolatedBrowser"
import {generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {signIn, signUp} from "./auth.setup"
import {ensureCurrentDeviceRegistered} from "./private-messaging-helpers"
import {usingBuiltDist} from "./utils/built-dist"

const needsLocalRelay = usingBuiltDist && process.env.IRIS_E2E_LOCAL_RELAY !== "true"
const chatLink = (page: Page) =>
  page.getByRole("link", {name: "Open Iris Chat", exact: true})

for (const viewport of [
  {name: "desktop", width: 1280, height: 800},
  {name: "mobile", width: 390, height: 844},
]) {
  test(`${viewport.name}: register here and keep the intended conversation`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90000)
    await page.setViewportSize(viewport)
    const secret = generateSecretKey()
    const publicKey = getPublicKey(secret)
    await signUp(page, nip19.nsecEncode(secret))

    for (const path of [
      "/chats",
      "/chats/new",
      "/chats/new/group",
      "/chats/new/devices",
    ]) {
      await page.goto(path)
      await expect(chatLink(page)).toHaveAttribute("href", "https://chat.iris.to/", {
        timeout: 15000,
      })
      await expect(
        page.getByRole("button", {name: "Register this device", exact: true})
      ).toBeVisible()
      await expect(
        page.getByRole("button", {name: "Link another device", exact: true})
      ).toBeHidden()
      await expect(
        page.getByPlaceholder("Search users, paste npub or chat invite link")
      ).toBeHidden()
    }

    await page.goto(`/${nip19.npubEncode(publicKey)}`)
    await page
      .getByTestId("profile-header-actions")
      .locator("button.btn-circle")
      .first()
      .click()
    await expect(page).toHaveURL(/\/chats\/chat$/)
    const destination = `https://chat.iris.to/#/${nip19.npubEncode(publicKey)}`
    await expect(chatLink(page)).toHaveAttribute("href", destination)
    await expect(page.getByPlaceholder("Message")).toBeHidden()
    await page.screenshot({
      path: testInfo.outputPath(`${viewport.name}-chat-registration.png`),
    })
    await page.getByRole("button", {name: "Register this device", exact: true}).click()
    const input = page.getByPlaceholder("Message").last()
    await expect(input).toBeEnabled({timeout: 30000})
    await expect(page).toHaveURL(/\/chats\/chat$/)
    await input.fill("Hello from this connected app")
    await input.press("Enter")
    const message = page
      .locator(".whitespace-pre-wrap")
      .getByText("Hello from this connected app")
      .last()
    await expect(message).toBeVisible()
    await page.reload()
    await expect(input).toBeEnabled({timeout: 15000})
    await expect(message).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath(`${viewport.name}-registered-chat.png`),
    })
  })
}

test("unregistered browsers offer chats without starting message subscriptions", async ({
  page,
}) => {
  test.skip(needsLocalRelay, "uses an isolated relay for account creation")
  await page.addInitScript(() => {
    const subscriptions: number[][] = []
    Object.assign(window, {__chatStartupSubscriptions: subscriptions})
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      postMessage(...args: Parameters<Worker["postMessage"]>) {
        const [message] = args
        if (message?.type === "subscribe") {
          for (const filter of message.filters || []) {
            if (filter.kinds?.some((kind: number) => kind === 1059 || kind === 1060))
              subscriptions.push(filter.kinds)
          }
        }
        super.postMessage(...args)
      }
    }
  })
  await signUp(page)
  await page.getByRole("link", {name: "Chats", exact: true}).click()
  await expect(chatLink(page)).toHaveAttribute("href", "https://chat.iris.to/", {
    timeout: 15000,
  })
  const messageSubscriptions = () =>
    page.evaluate(
      () =>
        (window as unknown as {__chatStartupSubscriptions: number[][]})
          .__chatStartupSubscriptions
    )
  expect(await messageSubscriptions()).toEqual([])
  await page.reload()
  await expect(chatLink(page)).toBeVisible({timeout: 15000})
  await expect(page.getByRole("link", {name: "New Chat", exact: true})).toBeHidden()
  expect(await messageSubscriptions()).toEqual([])
})

test("signed-out and read-only users can open Iris Chat without signing in here", async ({
  page,
}) => {
  await page.goto("/chats")
  await expect(chatLink(page)).toHaveAttribute("href", "https://chat.iris.to/")
  await signUp(page, nip19.npubEncode(getPublicKey(generateSecretKey())))
  await page.goto("/chats")
  await expect(chatLink(page)).toBeVisible()
  await expect(page.getByRole("heading", {name: "Sign in to use chats"})).toBeHidden()
})

test("existing registered devices keep chats and history after reload", async ({
  page,
}) => {
  test.skip(needsLocalRelay, "requires local-relay private messaging setup")
  test.setTimeout(60000)
  const owner = await signUp(page)
  await ensureCurrentDeviceRegistered(page)
  await page.goto(`/${nip19.npubEncode(owner.publicKey)}`)
  await page
    .getByTestId("profile-header-actions")
    .locator("button.btn-circle")
    .first()
    .click()
  const input = page.getByPlaceholder("Message").last()
  await expect(input).toBeEnabled({timeout: 15000})
  await input.fill("Keep my existing conversation")
  await input.press("Enter")
  await expect(
    page.locator(".whitespace-pre-wrap").getByText("Keep my existing conversation").last()
  ).toBeVisible()
  await page.reload()
  await expect(input).toBeEnabled({timeout: 15000})
  await expect(
    page.locator(".whitespace-pre-wrap").getByText("Keep my existing conversation").last()
  ).toBeVisible()
  await expect(chatLink(page)).toBeHidden()
  await page.goto("/chats/new/devices")
  await expect(page.getByRole("button", {name: "Link another device"})).toBeVisible()
})

test("a new browser opts in without replacing other connected devices", async ({
  page,
  browser,
  proxy,
}) => {
  test.skip(needsLocalRelay, "requires local-relay device setup")
  test.setTimeout(90000)
  const owner = await signUp(page)
  await ensureCurrentDeviceRegistered(page)
  const otherContext = await browser.newContext({proxy, serviceWorkers: "block"})
  try {
    const otherPage = await otherContext.newPage()
    await signIn(otherPage, owner.privateKey)
    await otherPage.goto("/chats")
    await expect(chatLink(otherPage)).toBeVisible({timeout: 15000})
    await expect(
      otherPage.getByRole("button", {name: "Register this device", exact: true})
    ).toBeVisible()
    await otherPage
      .getByRole("button", {name: "Register this device", exact: true})
      .click()
    const dialog = otherPage.getByRole("dialog", {name: "Register this device?"})
    await expect(dialog).toBeVisible({timeout: 20000})
    await dialog.getByRole("button", {name: "Cancel", exact: true}).click()
    await expect(
      otherPage.getByRole("button", {name: "Register this device", exact: true})
    ).toBeVisible()
    await otherPage
      .getByRole("button", {name: "Register this device", exact: true})
      .click()
    await dialog.getByRole("button", {name: "Register Device", exact: true}).click()
    await expect(
      otherPage.getByRole("link", {name: "New Chat", exact: true})
    ).toBeVisible({timeout: 30000})
    for (const devicePage of [page, otherPage]) {
      await devicePage.goto("/settings/devices")
      await expect(devicePage.getByTestId("registered-device-entry")).toHaveCount(2, {
        timeout: 15000,
      })
      await expect(
        devicePage.locator("span.badge").filter({hasText: /^This device$/})
      ).toBeVisible()
    }
  } finally {
    await otherContext.close()
  }
})

test("another tab still explains how to recover existing chats", async ({
  page,
  context,
}) => {
  test.skip(needsLocalRelay, "requires local-relay device setup")
  test.setTimeout(60000)
  await signUp(page)
  await ensureCurrentDeviceRegistered(page)
  const otherTab = await context.newPage()
  await otherTab.goto("/chats")
  await expect(
    otherTab.getByRole("heading", {name: "Chats is open in another tab"})
  ).toBeVisible()
  await page.close()
  await otherTab.getByRole("button", {name: "Reload", exact: true}).click()
  await expect(otherTab.getByRole("link", {name: "New Chat", exact: true})).toBeVisible({
    timeout: 15000,
  })
})
