import {expect, test} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {Relay} from "nostr-tools/relay"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

test("media feed loads past hidden timestamp ties and retains live bursts", async ({
  page,
}, testInfo) => {
  const viewer = generateSecretKey()
  const author = generateSecretKey()
  const pubkey = getPublicKey(author)
  const now = Math.floor(Date.now() / 1000) - 60
  const post = (content: string, created_at: number) =>
    finalizeEvent({kind: 1, tags: [], content, created_at}, author)
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [
      finalizeEvent(
        {kind: 3, tags: [["p", pubkey]], content: "", created_at: now},
        viewer
      ),
      ...Array.from({length: 3}, (_, index) =>
        post(`Unrelated plain text ${index}`, now)
      ),
      post("Older garden photo https://example.com/garden.jpg", now - 1),
    ],
  })

  try {
    await page.addInitScript(
      ({port, pubkey}) => {
        window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
        localStorage.setItem(
          "feed-storage",
          JSON.stringify({
            version: 2,
            state: {
              activeFeed: "hidden-history",
              enabledFeedIds: ["hidden-history"],
              feedConfigs: {
                "hidden-history": {
                  id: "hidden-history",
                  name: "Filtered history",
                  requiresMedia: true,
                  autoShowNewEvents: true,
                  filter: {kinds: [1], authors: [pubkey], limit: 3},
                },
              },
            },
          })
        )
      },
      {port: relay.port, pubkey}
    )
    await signUp(page, nip19.nsecEncode(viewer))
    const posts = page.locator('#main-content [data-testid="feed-item"]')
    const loadOlder = page.getByRole("button", {name: "Load older posts", exact: true})
    await expect(loadOlder).toBeVisible()
    await expect(posts).toHaveCount(0)
    await page.screenshot({path: testInfo.outputPath("empty-media-page.png")})
    await loadOlder.click()
    await expect(posts.filter({hasText: "Older garden photo"})).toBeVisible({
      timeout: 15000,
    })
    await expect(posts.filter({hasText: "Unrelated plain text"})).toHaveCount(0)

    const publisher = await Relay.connect(relay.url)
    try {
      await publisher.publish(
        post("Live garden photo https://example.com/live.jpg", now + 1)
      )
      await expect(posts.filter({hasText: "Live garden photo"})).toBeVisible()
      await Promise.all(
        Array.from({length: 12}, (_, index) =>
          publisher.publish(
            post(
              `Live burst photo ${index} https://example.com/burst.jpg`,
              now + 2 + index
            )
          )
        )
      )
      await expect(posts.filter({hasText: "Live burst photo 11"})).toBeVisible()
      await posts.last().scrollIntoViewIfNeeded()
      await expect(posts).toHaveCount(14)
    } finally {
      publisher.close()
    }
    await page.screenshot({path: testInfo.outputPath("media-history-and-live.png")})
  } finally {
    await relay.close()
  }
})

test("profile grid scrolls past the first relay page and includes picture posts", async ({
  page,
}, testInfo) => {
  const author = generateSecretKey()
  const pubkey = getPublicKey(author)
  const now = Math.floor(Date.now() / 1000) - 60
  const events = Array.from({length: 130}, (_, i) => {
    const url = `https://example.com/photo-${i}.jpg`
    const picture = i >= 100
    const caption = i % 9 === 0 ? url : `Plain text ${i}`
    return finalizeEvent(
      {
        kind: picture ? 20 : 1,
        content: picture ? "" : caption,
        tags: picture ? [["imeta", `url ${url}`, "m image/jpeg"]] : [],
        created_at: now - i,
      },
      author
    )
  })
  const relay = await startNostrRelay({port: 0, initialEvents: events})
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
    await page.goto(`/${nip19.npubEncode(pubkey)}`)
    await page.locator('#main-content use[href$="#media"]').locator("../..").click()
    const tiles = page.locator("#main-content .grid-cols-3 > .aspect-square")
    await expect(tiles.first()).toBeVisible()
    await expect(async () => {
      await tiles.last().scrollIntoViewIfNeeded()
      await expect(tiles).toHaveCount(42, {timeout: 700})
    }).toPass({timeout: 15000})
    await tiles.last().scrollIntoViewIfNeeded()
    await page.screenshot({path: testInfo.outputPath("older-profile-photos.png")})
  } finally {
    await relay.close()
  }
})
