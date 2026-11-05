import {expect, test} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {Relay} from "nostr-tools/relay"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"

const usingLocalRelay =
  process.env.IRIS_E2E_LOCAL_RELAY === "true" ||
  (!usingBuiltDist && !process.env.VITE_USE_TEST_RELAY)
test.skip(!usingLocalRelay, "requires deterministic local-relay recommendation data")

for (const viewport of [
  {width: 1280, height: 900},
  {width: 390, height: 844},
]) {
  test(`For You excludes recommended replies but keeps quotes at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    const viewer = generateSecretKey()
    const author = generateSecretKey()
    const authorPubkey = getPublicKey(author)
    const created_at = Math.floor(Date.now() / 1000) - 2
    const post = (content: string, tags: string[][] = [], kind = 1) =>
      finalizeEvent({kind, content, tags, created_at}, author)
    const parent = post("An original post with enough context to read on its own.")
    const replies = [
      post("Marked reply", [["e", parent.id, "", "reply"]]),
      post("Root-only reply", [["e", parent.id, "", "root"]]),
      post("Legacy reply", [["e", parent.id]]),
      post(
        "A comment",
        [
          ["E", parent.id],
          ["e", parent.id],
        ],
        1111
      ),
    ]
    const quote = post(`A standalone quote: nostr:${nip19.noteEncode(parent.id)}`, [
      ["q", parent.id],
    ])
    const mention = post("A standalone post that mentions another event.", [
      ["e", parent.id, "", "mention"],
    ])
    const relay = await Relay.connect("ws://127.0.0.1:7777")
    try {
      const events = [
        finalizeEvent(
          {kind: 3, content: "", tags: [["p", authorPubkey]], created_at},
          viewer
        ),
        parent,
        ...replies,
        quote,
        mention,
        ...[...replies, parent, quote, mention].map((event) =>
          post("+", [["e", event.id]], 7)
        ),
      ]
      for (const event of events) await relay.publish(event)
    } finally {
      relay.close()
    }
    await signUp(page, nip19.nsecEncode(viewer))
    const main = page.locator("#main-content")
    const item = (id: string) =>
      main.locator(`[data-testid="feed-item"][data-event-id="${id}"]`).first()
    for (const event of [parent, quote, mention]) {
      await expect(item(event.id)).toBeVisible({timeout: 15000})
    }
    for (const reply of replies) await expect(item(reply.id)).toHaveCount(0)
    await expect(item(mention.id).getByText(/Replying to/)).toHaveCount(0)
    await page.screenshot({path: testInfo.outputPath("for-you-top-level.png")})

    // The same reaction targets remain eligible in Popular.
    await main.getByRole("button", {name: "Popular", exact: true}).click()
    for (const reply of replies.slice(0, 3)) {
      await expect(item(reply.id)).toBeVisible({timeout: 15000})
    }
    await main.getByRole("button", {name: "For You", exact: true}).click()
    for (const event of [parent, quote, mention])
      await expect(item(event.id)).toBeVisible()
    for (const reply of replies) await expect(item(reply.id)).toHaveCount(0)

    // Excluding a reply from discovery does not remove its thread view.
    await page.goto(`/${nip19.noteEncode(replies[0].id)}`)
    await expect(main.getByText("Marked reply", {exact: true}).first()).toBeVisible()
    await expect(main.getByText(parent.content, {exact: true}).first()).toBeVisible()
  })
}
