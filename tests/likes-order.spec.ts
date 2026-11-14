import {expect, test} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

test("post Likes puts self and socially closest people first regardless of relay order", async ({
  page,
}, testInfo) => {
  const viewer = generateSecretKey()
  const keys = () =>
    [generateSecretKey(), generateSecretKey()].sort((a, b) =>
      getPublicKey(a).localeCompare(getPublicKey(b))
    )
  const [early, endorsed] = keys()
  const [indirectA, indirectB] = keys()
  const neighbor = generateSecretKey()
  const now = Math.floor(Date.now() / 1000) - 20
  const sign = (
    key: Uint8Array,
    kind: number,
    content: string,
    tags: string[][],
    offset = 0
  ) => finalizeEvent({kind, content, tags, created_at: now + offset}, key)
  const follows = (key: Uint8Array, ...friends: Uint8Array[]) =>
    sign(
      key,
      3,
      "",
      friends.map((friend) => ["p", getPublicKey(friend)])
    )
  const post = sign(viewer, 1, "Night on the north shore", [])
  const order = [viewer, endorsed, early, indirectA, indirectB]
  const names = ["River Journal", "Robin Vale", "June Park", "Ash Birch", "Coral Bay"]
  const events = [
    follows(viewer, early, endorsed, neighbor),
    follows(neighbor, endorsed, indirectA, indirectB),
    follows(early, endorsed),
    ...order.map((key, index) => sign(key, 0, JSON.stringify({name: names[index]}), [])),
    post,
    ...[indirectB, indirectA, early, endorsed, viewer].map((key, index) =>
      sign(
        key,
        7,
        index === 2 ? "🌲" : "+",
        [
          ["e", post.id],
          ["p", post.pubkey],
        ],
        5 - index
      )
    ),
  ]
  const relay = await startNostrRelay({port: 0, initialEvents: events})
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
    await signUp(page, nip19.npubEncode(getPublicKey(viewer)))
    await page.goto("/" + nip19.noteEncode(post.id))
    const note = page.locator(
      `#main-content [data-testid="feed-item"][data-event-id="${post.id}"]`
    )
    await note.locator("header").getByRole("button").click()
    await page.getByRole("button", {name: "Show reactions", exact: true}).click()
    const dialog = page.getByRole("dialog").filter({hasText: "Reactions to post by"})
    const rows = dialog.getByTestId("sidebar-user-row")
    await expect(rows).toHaveCount(order.length, {timeout: 20000})
    await expect
      .poll(() =>
        rows.evaluateAll((items) =>
          items.map((item) => item.querySelector("a")?.getAttribute("href"))
        )
      )
      .toEqual(order.map((key) => "/" + nip19.npubEncode(getPublicKey(key))))
    await expect(rows.nth(2)).toContainText("🌲")
    await expect(rows.first()).toContainText(names[0])
    await dialog.screenshot({path: testInfo.outputPath("social-like-order.png")})
  } finally {
    await relay.close()
  }
})
