import {expect, test} from "@playwright/test"
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

    for (const [step, picture] of [
      ["add", firstPicture],
      ["replace", nextPicture],
      ["clear", ""],
    ]) {
      await test.step(step, async () => {
        // Kind-0 events are replaceable; avoid equal-second updates obscuring
        // whether a new picture survived the real publication and reload path.
        await expect
          .poll(() => Math.floor(Date.now() / 1000))
          .toBeGreaterThan(previousCreatedAt)
        const countBeforeSave = published.size
        await pictureInput.fill(picture)
        await page
          .getByRole("button", {name: "Save Changes", exact: true})
          .first()
          .click()
        await expect.poll(() => published.size).toBeGreaterThan(countBeforeSave)
        const event = [...published.values()].at(-1)!
        expect(verifyEvent(event)).toBe(true)
        const content = JSON.parse(event.content)
        expect(content).toMatchObject({
          name: initialProfile.name,
          about: initialProfile.about,
          website: initialProfile.website,
          picture,
        })
        expect(content).not.toHaveProperty("image")
        previousCreatedAt = event.created_at

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
  } finally {
    await page.close()
    await relay.close()
  }
})
