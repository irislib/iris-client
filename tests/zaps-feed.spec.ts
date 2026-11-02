import {expect, test} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

test("zaps show their target once while replies keep their parent context", async ({
  page,
}, testInfo) => {
  const viewer = generateSecretKey()
  const author = generateSecretKey()
  const zapper = generateSecretKey()
  const now = Math.floor(Date.now() / 1000) - 60
  const post = finalizeEvent(
    {kind: 1, tags: [], content: "A post worth zapping", created_at: now},
    author
  )
  const reply = finalizeEvent(
    {
      kind: 1,
      tags: [["e", post.id, "", "root"]],
      content: "A reply with parent context",
      created_at: now + 1,
    },
    viewer
  )
  const zapRequest = finalizeEvent(
    {
      kind: 9734,
      tags: [
        ["e", post.id],
        ["p", post.pubkey],
      ],
      content: "Thanks for this post!",
      created_at: now + 2,
    },
    viewer
  )
  const zap = finalizeEvent(
    {
      kind: 9735,
      tags: [
        ["e", post.id],
        ["p", post.pubkey],
        ["P", getPublicKey(viewer)],
        ["description", JSON.stringify(zapRequest)],
      ],
      content: "",
      created_at: now + 3,
    },
    zapper
  )
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [post, reply, zap],
  })

  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
    await signUp(page, nip19.nsecEncode(viewer))
    await page.goto(`/${nip19.npubEncode(getPublicKey(viewer))}`)
    await page.getByRole("button", {name: "Zaps", exact: true}).click()

    const main = page.locator("#main-content")
    const zapItem = main.locator(`[data-testid="feed-item"][data-event-id="${zap.id}"]`)
    const postItem = main.locator(`[data-testid="feed-item"][data-event-id="${post.id}"]`)
    await expect(zapItem.getByText(post.content, {exact: true})).toBeVisible()
    await expect(zapItem.getByText(zapRequest.content, {exact: false})).toBeVisible()
    await expect(main.getByText(post.content, {exact: true})).toHaveCount(1)
    await expect(postItem).toHaveCount(0)
    await page.screenshot({path: testInfo.outputPath("zaps-feed.png")})

    // Direct links use the same receipt rendering with parent context enabled.
    await page.goto(`/${nip19.noteEncode(zap.id)}`)
    await expect(zapItem.getByText(post.content, {exact: true})).toBeVisible()
    await expect(main.getByText(post.content, {exact: true})).toHaveCount(1)
    await expect(postItem).toHaveCount(0)

    // A real reply must still render its parent above it.
    await page.goto(`/${nip19.noteEncode(reply.id)}`)
    await expect(main.getByText(reply.content, {exact: true})).toBeVisible()
    await expect(postItem.getByText(post.content, {exact: true})).toBeVisible()
    await expect(main.getByText(post.content, {exact: true})).toHaveCount(1)
  } finally {
    await relay.close()
  }
})
