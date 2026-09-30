import {expect, test} from "@playwright/test"
import {fileURLToPath} from "node:url"
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  verifyEvent,
  type VerifiedEvent,
} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

test("profile pictures can be added, replaced, and cleared across reloads", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000)
  await page.setViewportSize({width: 1280, height: 1200})
  const secret = generateSecretKey()
  const publicKey = getPublicKey(secret)
  const initialProfile = {
    name: "Profile Picture Test",
    about: "Keep this description when changing the picture",
    website: "https://example.com/",
    bot: true,
    lud06: "lnurl1legacyprofilevalue",
    customLabel: "Keep this extension",
    customCount: 7,
    customEmpty: null,
    profileEvent: "An original metadata field, not the cached event envelope",
    customData: {
      enabled: false,
      nested: {labels: ["one", "two"], mention: `@${nip19.npubEncode(publicKey)}`},
    },
    customItems: [1, "two", null, {three: true}],
  }
  const initialEvent = finalizeEvent(
    {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000) - 60,
      tags: [],
      content: JSON.stringify(initialProfile),
    },
    secret
  )
  const published = new Map<string, VerifiedEvent>()
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [initialEvent],
    acknowledgeEvent: (event, acknowledge) => {
      if (event.kind === 0 && event.pubkey === publicKey) published.set(event.id, event)
      acknowledge()
    },
  })

  try {
    // The injected relay also pins production builds and their background worker
    // to this test's socket, without publishing test identities to public relays.
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
      localStorage.setItem(
        "settings-storage",
        JSON.stringify({state: {imgproxy: {enabled: false}}, version: 0})
      )
    }, relay.port)
    await signUp(page, nip19.nsecEncode(secret))
    await page.goto("/settings/profile")
    const pictureGroup = page
      .getByRole("heading", {name: "Profile Picture", exact: true})
      .locator("..")
    const pictureInput = pictureGroup.getByPlaceholder("https://example.com/image.jpg")
    const aboutInput = page.getByPlaceholder("About yourself")
    const websiteInput = page.getByPlaceholder("https://example.com", {exact: true})
    await expect(aboutInput).toHaveValue(initialProfile.about)
    await expect(pictureInput).toHaveValue("")

    const baseURL = testInfo.project.use.baseURL!
    const firstPicture = new URL("/favicon.png", baseURL).href
    const nextPicture = new URL("/img/icon128.png", baseURL).href
    let previousCreatedAt = initialEvent.created_at
    const profileAvatar = page.locator("#main-content .items-center.mb-6 img").first()
    const sidebarAvatar = page
      .getByTestId("desktop-sidebar")
      .getByTestId("sidebar-user-row")
      .locator("img")
      .first()

    const saveAndCheck = async (expected: Record<string, unknown>) => {
      const countBeforeSave = published.size
      await page.getByRole("button", {name: "Save Changes", exact: true}).first().click()
      await expect.poll(() => published.size).toBeGreaterThan(countBeforeSave)
      const event = [...published.values()].at(-1)!
      expect(verifyEvent(event)).toBe(true)
      const content = JSON.parse(event.content)
      expect(content).toEqual(expected)
      for (const internalField of ["pubkey", "created_at"]) {
        expect(content).not.toHaveProperty(internalField)
      }
      expect(content).not.toHaveProperty("image")
      expect(event.created_at).toBeGreaterThan(previousCreatedAt)
      previousCreatedAt = event.created_at
      await expect(page.getByRole("status")).toHaveText("Changes saved")
    }

    for (const [step, picture] of [
      ["add", firstPicture],
      ["replace", nextPicture],
      ["clear", ""],
    ]) {
      await test.step(step, async () => {
        // Exercise equal-second saves; the editor must still publish a newer event.
        await page.clock.setFixedTime(new Date(previousCreatedAt * 1000))
        await pictureInput.fill(picture)
        await expect(pictureInput).toHaveAccessibleDescription("Unsaved")
        await expect(aboutInput).toHaveAccessibleDescription("")
        await expect(page.getByRole("status")).toHaveText("Unsaved changes")
        await expect(
          page.getByRole("button", {name: "Save Changes", exact: true})
        ).toBeInViewport()
        if (step === "replace") {
          await page.screenshot({path: testInfo.outputPath("desktop-photo-unsaved.png")})
        }
        await saveAndCheck({...initialProfile, picture})
        await expect(pictureInput).toHaveAccessibleDescription("")

        // Saving must update the mounted avatar, not just the editor preview.
        if (picture) {
          await expect(profileAvatar).toHaveAttribute("src", picture)
          await expect(sidebarAvatar).toHaveAttribute("src", picture)
          await expect
            .poll(() =>
              profileAvatar.evaluate((image: HTMLImageElement) => image.naturalWidth)
            )
            .toBeGreaterThan(0)
        } else {
          await expect(profileAvatar).toHaveAttribute("alt", "User Avatar")
          await expect(sidebarAvatar).toHaveAttribute("alt", "User Avatar")
        }

        await page.reload()
        await expect(aboutInput).toHaveValue(initialProfile.about)
        await expect(websiteInput).toHaveValue(initialProfile.website)
        await expect(pictureInput).toHaveValue(picture)
        const preview = pictureGroup.getByRole("img", {name: "Profile preview"})
        if (picture) {
          await expect(preview).toHaveAttribute("src", picture)
          await expect
            .poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth))
            .toBeGreaterThan(0)
        } else {
          await expect(preview).toHaveCount(0)
        }
      })
    }

    // Replace and clear already round-trip the preceding reload. A final ordinary
    // editor change verifies uneditable metadata survived the clear/reload too.
    await test.step("uneditable metadata survives the final reload", async () => {
      await expect
        .poll(() => Math.floor(Date.now() / 1000))
        .toBeGreaterThan(previousCreatedAt)
      const about = `${initialProfile.about} after reload`
      await aboutInput.fill(about)
      await expect(aboutInput).toHaveAccessibleDescription("Unsaved")
      await saveAndCheck({...initialProfile, picture: "", about})
      await expect(aboutInput).toHaveAccessibleDescription("")
    })
  } finally {
    await page.close()
    await relay.close()
  }
})

test("an uploaded photo stays a draft until saved with the visible mobile save bar", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({width: 390, height: 844})
  const baseURL = testInfo.project.use.baseURL!
  const oldPicture = new URL("/favicon.png", baseURL).href
  const newPicture = new URL("/img/icon128.png", baseURL).href
  const uploadServer = new URL("/profile-photo-test", baseURL).href
  const secret = generateSecretKey()
  const publicKey = getPublicKey(secret)
  const published = new Map<string, VerifiedEvent>()
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [
      finalizeEvent(
        {
          kind: 0,
          created_at: Math.floor(Date.now() / 1000) - 60,
          tags: [],
          content: JSON.stringify({name: "Photo Upload Test", picture: oldPicture}),
        },
        secret
      ),
    ],
    acknowledgeEvent: (event, acknowledge) => {
      if (event.kind === 0 && event.pubkey === publicKey) published.set(event.id, event)
      acknowledge()
    },
  })

  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
      localStorage.setItem(
        "settings-storage",
        JSON.stringify({state: {imgproxy: {enabled: false}}, version: 0})
      )
    }, relay.port)
    await signUp(page, nip19.nsecEncode(secret))
    await page.evaluate((url) => {
      const user = JSON.parse(localStorage.getItem("user-storage")!)
      const server = {url, protocol: "blossom"}
      user.state.defaultMediaserver = server
      user.state.mediaservers = [server]
      localStorage.setItem("user-storage", JSON.stringify(user))
    }, uploadServer)
    await page.route(`${uploadServer}/upload`, (route) =>
      route.fulfill({json: {url: newPicture}})
    )
    await page.goto("/settings/profile")
    const pictureInput = page.getByPlaceholder("https://example.com/image.jpg")
    const profileAvatar = page.locator("#main-content .items-center.mb-6 img").first()
    const saveButton = page.getByRole("button", {name: "Save Changes", exact: true})
    await expect(pictureInput).toHaveValue(oldPicture)
    await expect(profileAvatar).toHaveAttribute("src", oldPicture)

    // Reverting a draft removes the save prompt without publishing anything.
    await pictureInput.fill(newPicture)
    await expect(page.getByRole("status")).toHaveText("Unsaved changes")
    await expect(pictureInput).toHaveAccessibleDescription("Unsaved")
    await pictureInput.fill(oldPicture)
    await expect(saveButton).toHaveCount(0)
    await expect(pictureInput).toHaveAccessibleDescription("")

    const chooserPromise = page.waitForEvent("filechooser")
    await page.getByRole("button", {name: "Upload Profile Picture", exact: true}).click()
    const chooser = await chooserPromise
    await chooser.setFiles(
      fileURLToPath(new URL("fixtures/test-blob.jpeg", import.meta.url))
    )
    await expect(pictureInput).toHaveValue(newPicture)
    await expect(page.getByRole("img", {name: "Profile preview"})).toHaveAttribute(
      "src",
      newPicture
    )
    await expect(page.getByRole("status")).toHaveText("Unsaved changes")
    await expect(pictureInput).toHaveAccessibleDescription("Unsaved")
    await expect(saveButton).toBeEnabled()
    await expect(saveButton).toBeInViewport({ratio: 1})
    await expect(profileAvatar).toHaveAttribute("src", oldPicture)
    expect(published.size).toBe(0)
    await page.screenshot({path: testInfo.outputPath("uploaded-photo-unsaved.png")})

    // The save control stays reachable further down the form too.
    await page.getByPlaceholder("user@wallet.com").scrollIntoViewIfNeeded()
    await expect(saveButton).toBeInViewport({ratio: 1})
    await saveButton.click()
    await expect(page.getByRole("status")).toHaveText("Changes saved")
    await expect.poll(() => published.size).toBe(1)
    const saved = [...published.values()][0]
    expect(verifyEvent(saved)).toBe(true)
    expect(JSON.parse(saved.content).picture).toBe(newPicture)
    await expect(profileAvatar).toHaveAttribute("src", newPicture)
    await expect(pictureInput).toHaveAccessibleDescription("")
    await profileAvatar.scrollIntoViewIfNeeded()
    await page.screenshot({path: testInfo.outputPath("uploaded-photo-saved.png")})
    await page.reload()
    await expect(pictureInput).toHaveValue(newPicture)
    await expect(profileAvatar).toHaveAttribute("src", newPicture)
  } finally {
    await page.close()
    await relay.close()
  }
})

test("a nameless new account can save its first profile edit", async ({page}) => {
  const published = new Map<string, VerifiedEvent>()
  const relay = await startNostrRelay({
    port: 0,
    acknowledgeEvent: (event, acknowledge) => {
      if (event.kind === 0) published.set(event.id, event)
      acknowledge()
    },
  })
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
    const account = await signUp(page, "")
    await expect
      .poll(() =>
        [...published.values()].some((event) => event.pubkey === account.publicKey)
      )
      .toBe(true)
    const initialEvent = [...published.values()].find(
      (event) => event.pubkey === account.publicKey
    )!
    expect(verifyEvent(initialEvent)).toBe(true)
    expect(JSON.parse(initialEvent.content)).toEqual({})

    await page.goto("/settings/profile")
    const aboutInput = page.getByPlaceholder("About yourself")
    await expect(aboutInput).toHaveValue("")
    await expect
      .poll(() => Math.floor(Date.now() / 1000))
      .toBeGreaterThan(initialEvent.created_at)
    const countBeforeSave = published.size
    const about = "First profile edit without choosing a name"
    await aboutInput.fill(about)
    await page.getByRole("button", {name: "Save Changes", exact: true}).first().click()
    await expect.poll(() => published.size).toBeGreaterThan(countBeforeSave)
    const event = [...published.values()].at(-1)!
    expect(event.pubkey).toBe(account.publicKey)
    expect(verifyEvent(event)).toBe(true)
    expect(JSON.parse(event.content)).toEqual({about})

    await page.reload()
    await expect(aboutInput).toHaveValue(about)
    await expect(page.getByPlaceholder("Your name")).toHaveValue("")
  } finally {
    await page.close()
    await relay.close()
  }
})
