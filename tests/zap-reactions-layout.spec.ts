import {expect, test} from "@playwright/test"
import {bech32} from "@scure/base"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

// Nonpayable fixture. Each signed request normally represents a distinct payment.
function invoiceFor(msats: number, paymentHash?: string, timestamp = 0) {
  const hashWords = paymentHash
    ? [1, 1, 20, ...bech32.toWords(Buffer.from(paymentHash, "hex"))]
    : []
  return bech32.encode(
    `lnbc${msats * 10}p`,
    [...new Array(6).fill(0), timestamp, ...hashWords, ...new Array(104).fill(0)],
    2000
  )
}

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
              ["bolt11", invoiceFor(1_000_000, request.id)],
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

test("post zap senders keep the message from their largest public tip", async ({
  page,
}, testInfo) => {
  const viewer = generateSecretKey()
  const service = generateSecretKey()
  const now = Math.floor(Date.now() / 1000) - 120
  const post = finalizeEvent(
    {kind: 1, tags: [], content: "Largest zap messages", created_at: now},
    viewer
  )
  const events = [post]
  function sender(name: string) {
    const key = generateSecretKey()
    events.push(
      finalizeEvent(
        {kind: 0, tags: [], content: JSON.stringify({name}), created_at: now},
        key
      )
    )
    return key
  }
  function add(
    key: Uint8Array,
    msats: number,
    content: string,
    time: number,
    options: {anon?: string[]; tamper?: boolean; target?: string; invoice?: string} = {}
  ) {
    const tags = [
      ["e", options.target ?? post.id],
      ["p", post.pubkey],
    ]
    if (options.anon) tags.push(options.anon)
    const request = finalizeEvent(
      {kind: 9734, tags, content, created_at: now + time},
      key
    )
    const invoice = options.invoice ?? invoiceFor(msats, request.id)
    const receipt = finalizeEvent(
      {
        kind: 9735,
        tags: [
          ["e", post.id],
          ["p", post.pubkey],
          ["P", getPublicKey(key)],
          [
            "description",
            JSON.stringify(
              options.tamper ? {...request, content: "Forged text"} : request
            ),
          ],
          ["bolt11", invoice],
        ],
        content: "Outer receipt text",
        created_at: now + time,
      },
      service
    )
    events.push(receipt)
    return receipt.id
  }
  const first = sender("River")
  const originalInvoice = invoiceFor(7_900, post.id)
  add(first, 7_900, "The largest tip", 1, {invoice: originalInvoice})
  add(first, 7_900, "Later receipt with the same invoice", 50, {invoice: originalInvoice})
  add(first, 7_900, "Reissued invoice with the same payment hash", 51, {
    invoice: invoiceFor(7_900, post.id, 1),
  })
  add(first, 7_100, "A smaller tip in the same sat", 20)
  const second = sender("Willow")
  const hashlessInvoice = invoiceFor(13_000)
  add(second, 13_000, "   ", 3, {invoice: hashlessInvoice})
  add(second, 13_000, "Hashless invoice reissue", 55, {
    invoice: hashlessInvoice.toUpperCase(),
  })
  add(second, 1_000, "Smaller thank you", 4)
  const third = sender("Robin")
  const a = add(third, 3_000, "A tied message", 5)
  const b = add(third, 3_000, "Another tied message", 5)
  add(third, 3_000, "An older tied message", 1)
  add(third, 3_000, "", 30)
  add(sender("Unlisted anonymous signer"), 4_000, "Anonymous text", 6, {anon: ["anon"]})
  add(sender("Unlisted private signer"), 5_000, "Private text", 7, {
    anon: ["anon", "encrypted"],
  })
  add(first, 99_000, "Original text", 8, {tamper: true})
  add(first, 98_000, "A different post", 9, {target: "a".repeat(64)})
  const relay = await startNostrRelay({port: 0, initialEvents: events})
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
    await signUp(page, nip19.nsecEncode(viewer))
    await page.goto(`/${nip19.noteEncode(post.id)}`)
    await page
      .locator(`#main-content [data-event-id="${post.id}"] header`)
      .getByRole("button")
      .click()
    await page.getByRole("button", {name: "Show reactions", exact: true}).click()
    const dialog = page.getByRole("dialog").filter({hasText: "Reactions to post by"})
    await dialog.getByRole("button", {name: "Zaps", exact: true}).click()
    const rows = dialog.getByRole("list", {name: "Zap senders"}).getByRole("listitem")
    await expect(rows).toHaveCount(4)
    await expect(rows.nth(0)).toHaveText(/River.*15 sats.*The largest tip/)
    await expect(rows.nth(1)).toHaveText(/Willow.*14 sats$/)
    await expect(rows.nth(2)).toHaveText(
      new RegExp(`Robin.*12 sats.*${a < b ? "A tied message" : "Another tied message"}$`)
    )
    await expect(rows.nth(3)).toHaveText(/Anonymous.*9 sats$/)
    await expect(rows.nth(3).getByRole("link")).toHaveCount(0)
    await expect(
      dialog.getByText(
        /Outer receipt text|Unlisted|Forged text|A different post|Smaller thank you/
      )
    ).toHaveCount(0)
    await dialog.screenshot({path: testInfo.outputPath("largest-zap-messages.png")})
  } finally {
    await relay.close()
  }
})
