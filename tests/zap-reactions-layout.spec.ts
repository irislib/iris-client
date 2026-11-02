import {expect, test} from "@playwright/test"
import {bech32} from "@scure/base"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

for (const width of [390, 1280]) {
  test(`zap reactions keep names readable and comments contained at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({width, height: 900})
    const viewer = generateSecretKey()
    const service = generateSecretKey()
    const now = Math.floor(Date.now() / 1000) - 60
    const post = finalizeEvent(
      {kind: 1, tags: [], content: "Zap reactions layout", created_at: now},
      viewer
    )
    const comment = "Zapvertise: thanks for sharing. Campaign reward — zapvertise.iris.to"
    const longComment = `https://example.com/${"unbroken".repeat(30)}`
    // Amount-only invoice fixture, with no payable signature or payment hash.
    const invoice = bech32.encode("lnbc10u", new Array(111).fill(0), 2000)
    const events = [post]
    for (const [name, content] of [
      ["nostrvpn.org", comment],
      ["Long comment sender", longComment],
      ["Quiet sender", ""],
    ]) {
      const sender = generateSecretKey()
      const request = finalizeEvent(
        {
          kind: 9734,
          tags: [
            ["e", post.id],
            ["p", post.pubkey],
          ],
          content,
          created_at: now + 1,
        },
        sender
      )
      events.push(
        finalizeEvent(
          {kind: 0, tags: [], content: JSON.stringify({name}), created_at: now},
          sender
        ),
        finalizeEvent(
          {
            kind: 9735,
            tags: [
              ["e", post.id],
              ["p", post.pubkey],
              ["P", getPublicKey(sender)],
              ["description", JSON.stringify(request)],
              ["bolt11", invoice],
            ],
            content: "",
            created_at: now + 2,
          },
          service
        )
      )
    }
    const relay = await startNostrRelay({port: 0, initialEvents: events})
    try {
      await page.addInitScript((port) => {
        window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
      }, relay.port)
      await signUp(page, nip19.nsecEncode(viewer))
      await page.goto(`/${nip19.noteEncode(post.id)}`)
      const postRow = page.locator(
        `#main-content [data-testid="feed-item"][data-event-id="${post.id}"]`
      )
      await postRow.locator("header").getByRole("button").click()
      await page.getByRole("button", {name: "Show reactions", exact: true}).click()
      const dialog = page.getByRole("dialog").filter({hasText: "Reactions to post by"})
      await dialog.getByRole("button", {name: "Zaps", exact: true}).click()
      const senderName = dialog.getByText("nostrvpn.org", {exact: true})
      await expect(senderName).toBeVisible()
      await expect(dialog.getByText(comment, {exact: false})).toBeVisible()
      expect(
        await senderName.evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          return range.getClientRects().length
        })
      ).toBe(1)

      const nameBox = (await senderName.boundingBox())!
      const commentBox = (await dialog.getByText(comment, {exact: true}).boundingBox())!
      expect(commentBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height)
      await expect(dialog.getByText("1K sats", {exact: true})).toHaveCount(3)
      await expect(dialog.getByText("Quiet sender", {exact: true})).toBeVisible()
      const unbroken = dialog.getByText(longComment, {exact: true})
      await expect(unbroken).toBeVisible()
      expect(
        await unbroken.evaluate((element) => element.scrollWidth <= element.clientWidth)
      ).toBe(true)
      expect(
        await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)
      ).toBe(true)
      await dialog.screenshot({path: testInfo.outputPath("zap-reactions.png")})
    } finally {
      await relay.close()
    }
  })
}
