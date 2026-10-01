import {expect, test, type Page} from "@playwright/test"
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  type VerifiedEvent,
} from "nostr-tools"
import {mkdir} from "node:fs/promises"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

test("private details sync between devices with durable clears and account isolation", async ({
  browser,
}) => {
  const ownerKey = generateSecretKey(),
    peerKey = generateSecretKey()
  const peer = getPublicKey(peerKey)
  const events: VerifiedEvent[] = []
  let offline = false
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [
      finalizeEvent(
        {
          kind: 0,
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
          content: JSON.stringify({name: "Alice Public"}),
        },
        peerKey
      ),
    ],
    rejectEvent: (event) =>
      offline && [30078, 1059, 1060].includes(event.kind) ? "offline" : undefined,
    acknowledgeEvent: (event, ack) => {
      events.push(event)
      ack()
    },
  })
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ])
  const [a, b, c] = await Promise.all(contexts.map((context) => context.newPage()))
  async function open(page: Page, key: Uint8Array) {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
    await signUp(page, nip19.nsecEncode(key))
    await page.goto(`/${nip19.npubEncode(peer)}`)
    await page.getByText("Private details", {exact: true}).click()
  }
  try {
    await open(a, ownerKey)
    await open(b, ownerKey)
    await a.getByRole("button", {name: "Favorite", exact: true}).click()
    await expect(b.getByRole("button", {name: "Favorited", exact: true})).toBeVisible()
    await a.getByLabel("Nickname", {exact: true}).fill("Private Alice")
    await a.getByLabel("Note", {exact: true}).fill("Our private meeting note")
    await a.getByRole("button", {name: "Save", exact: true}).click()
    await expect(b.getByLabel("Nickname", {exact: true})).toHaveValue("Private Alice")
    await expect(b.getByLabel("Note", {exact: true})).toHaveValue(
      "Our private meeting note"
    )
    await expect(
      b.locator("#main-content").getByText("Private Alice", {exact: true}).first()
    ).toBeVisible()
    await expect
      .poll(() => events.filter((event) => event.kind === 30078).length)
      .toBeGreaterThan(0)
    for (const event of events.filter((event) => event.kind === 30078)) {
      expect(JSON.stringify(event)).not.toContain(peer)
      expect(event.content).not.toContain("Private Alice")
      expect(event.content).not.toContain("meeting note")
    }
    offline = true
    await a.getByLabel("Note", {exact: true}).fill("")
    await a.getByRole("button", {name: "Save", exact: true}).click()
    await a.getByRole("button", {name: "Favorited", exact: true}).click()
    await expect(a.getByRole("button", {name: "Favorite", exact: true})).toBeVisible()
    await a.reload()
    await a.getByText("Private details", {exact: true}).click()
    await expect(a.getByLabel("Note", {exact: true})).toHaveValue("")
    await expect(a.getByRole("button", {name: "Favorite", exact: true})).toBeVisible()
    await expect(b.getByLabel("Note", {exact: true})).toHaveValue(
      "Our private meeting note"
    )
    offline = false
    await a.evaluate(() => window.dispatchEvent(new Event("online")))
    await expect(b.getByLabel("Note", {exact: true})).toHaveValue("")
    await expect(b.getByRole("button", {name: "Favorite", exact: true})).toBeVisible()
    await open(c, generateSecretKey())
    await expect(c.getByLabel("Nickname", {exact: true})).toHaveValue("")
    await expect(c.getByRole("button", {name: "Favorite", exact: true})).toBeVisible()
    await mkdir("work/private-contact-sync", {recursive: true})
    await a.setViewportSize({width: 1280, height: 900})
    await a.screenshot({
      path: "work/private-contact-sync/client-desktop.png",
      fullPage: true,
    })
    await a.setViewportSize({width: 390, height: 844})
    await a.screenshot({
      path: "work/private-contact-sync/client-mobile.png",
      fullPage: true,
    })
  } finally {
    for (const context of contexts) await context.close()
    await relay.close()
  }
})
