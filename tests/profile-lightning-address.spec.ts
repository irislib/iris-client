import {expect, test} from "@playwright/test"
import {
  finalizeEvent,
  getPublicKey,
  nip19,
  verifyEvent,
  type VerifiedEvent,
} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

for (const width of [1280, 390]) {
  test(`npub.cash address stays a draft until saved at ${width}px`, async ({
    page,
  }, testInfo) => {
    const secret = new Uint8Array(32).fill(23)
    const publicKey = getPublicKey(secret)
    const address = `${nip19.npubEncode(publicKey)}@npub.cash`
    const initialProfile = {
      name: "Lightning Test",
      about: "Keep my profile",
      custom: {preserve: true},
      ...(width === 1280 ? {lud16: "existing@example.com"} : {}),
    }
    const published = new Map<string, VerifiedEvent>()
    const relay = await startNostrRelay({
      port: 0,
      initialEvents: [
        finalizeEvent(
          {
            kind: 0,
            created_at: Math.floor(Date.now() / 1000) - 60,
            tags: [],
            content: JSON.stringify(initialProfile),
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
      }, relay.port)
      await signUp(page, nip19.nsecEncode(secret))
      await page.setViewportSize({width, height: 900})
      await page.goto("/settings/profile")
      const input = page.getByRole("textbox", {name: "Lightning Address"})
      const useAddress = page.getByRole("button", {name: `Use ${address}`, exact: true})
      await expect(input).toBeEnabled()
      await expect(input).toHaveValue(initialProfile.lud16 ?? "")
      if (initialProfile.lud16) {
        await expect(useAddress).toHaveCount(0)
        await input.fill("")
      }
      await expect(useAddress).toBeVisible()
      await input.fill("custom@example.com")
      await expect(useAddress).toHaveCount(0)
      await input.fill(" ")
      await expect(useAddress).toBeVisible()
      await useAddress.evaluate((button) =>
        button.scrollIntoView({block: "center", behavior: "instant"})
      )
      await expect(useAddress).toBeInViewport({ratio: 1})
      await page.screenshot({path: testInfo.outputPath("npub-cash-offer.png")})
      await useAddress.click()
      await expect(input).toHaveValue(address)
      await expect(useAddress).toHaveCount(0)
      await expect(input).toHaveAccessibleDescription("Unsaved")
      expect(published.size).toBe(0)

      await page.getByRole("button", {name: "Save Changes", exact: true}).click()
      await expect(page.getByRole("status")).toHaveText("Changes saved")
      await expect.poll(() => published.size).toBe(1)
      const saved = [...published.values()][0]
      expect(verifyEvent(saved)).toBe(true)
      expect(JSON.parse(saved.content)).toEqual({...initialProfile, lud16: address})
      await page.reload()
      await expect(input).toHaveValue(address)
      await expect(useAddress).toHaveCount(0)
    } finally {
      await page.close()
      await relay.close()
    }
  })
}
