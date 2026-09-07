import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {Relay} from "nostr-tools/relay"
import {SocialGraph} from "nostr-social-graph"
import {usingBuiltDist} from "./utils/built-dist"

test("can search for content", async ({page}) => {
  await signUp(page)

  const searchInput = page.getByPlaceholder("Search")
  await searchInput.fill("bitcoin")
  await searchInput.press("Enter")

  // Wait for navigation to complete
  await expect(page).toHaveURL(/\/search/, {timeout: 10000})
})

test("search uses the starter network and does not skip between recent and old matches", async ({
  page,
}, testInfo) => {
  test.skip(usingBuiltDist || !!process.env.VITE_USE_TEST_RELAY, "requires local relay")
  const viewer = generateSecretKey()
  const author = generateSecretKey()
  const stranger = generateSecretKey()
  const muted = generateSecretKey()
  const root = "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0"
  const graph = new SocialGraph(root)
  graph.addFollower(root, getPublicKey(author))
  graph.addFollower(root, getPublicKey(muted))
  await graph.recalculateFollowDistances()
  const snapshot = Buffer.from(await graph.toBinary())
  await page.route(/socialGraph[^/]*\.bin(?:\?.*)?$/, (route) =>
    route.request().resourceType() === "script"
      ? route.continue()
      : route.fulfill({contentType: "application/octet-stream", body: snapshot})
  )
  const query = `iris${getPublicKey(viewer).slice(0, 12)}`
  const now = Math.floor(Date.now() / 1000) - 10
  const day = 86400
  const relay = await Relay.connect("ws://127.0.0.1:7777")
  const publish = (
    key: Uint8Array,
    content: string,
    created_at: number,
    tags: string[][] = [],
    kind = 1
  ) => relay.publish(finalizeEvent({kind, content, tags, created_at}, key))
  try {
    await publish(viewer, "", now, [], 3)
    await publish(viewer, "", now, [["p", getPublicKey(muted)]], 10000)
    await publish(author, `${query} recent July match`, now - 40 * day)
    // More than one relay page of nonmatches must not prevent looking further back.
    for (let i = 0; i < 120; i++)
      await publish(author, `unrelated ${i}`, now - 41 * day - i)
    await publish(author, `${query} middle June match`, now - 90 * day)
    await publish(author, `${query} old February match`, now - 210 * day, [["t", query]])
    await publish(stranger, `${query} unknown match`, now - 42 * day, [["t", query]])
    await publish(muted, `${query} muted match`, now - 42 * day, [["t", query]])
  } finally {
    relay.close()
  }
  await signUp(page, nip19.nsecEncode(viewer))
  await page.goto(`/search/${query}`)
  const posts = page.locator('#main-content [data-testid="feed-item"]:visible')
  await expect(posts.filter({hasText: "recent July match"})).toBeVisible({timeout: 15000})
  await expect(posts.filter({hasText: "middle June match"})).toBeVisible({timeout: 15000})
  await expect(posts.filter({hasText: "old February match"})).toBeVisible()
  await expect(posts.filter({hasText: "unknown match"})).toHaveCount(0)
  await expect(posts.filter({hasText: "muted match"})).toHaveCount(0)
  await page.getByRole("checkbox", {name: "Show posts from unknown users"}).check()
  await expect(posts.filter({hasText: "unknown match"})).toBeVisible({timeout: 15000})
  await expect(posts.filter({hasText: "muted match"})).toHaveCount(0)
  await page.screenshot({path: testInfo.outputPath("search-results.png")})
})

test("an empty search can continue past several pages of nonmatches", async ({page}) => {
  test.skip(usingBuiltDist || !!process.env.VITE_USE_TEST_RELAY, "requires local relay")
  const viewer = generateSecretKey()
  const query = `iris${getPublicKey(viewer).slice(0, 12)}`
  const now = Math.floor(Date.now() / 1000) - 5
  const relay = await Relay.connect("ws://127.0.0.1:7777")
  try {
    for (let i = 0; i < 320; i++) {
      await relay.publish(
        finalizeEvent(
          {kind: 1, content: `nonmatch ${i}`, created_at: now - i, tags: []},
          viewer
        )
      )
    }
    await relay.publish(
      finalizeEvent(
        {kind: 1, content: `${query} older match`, created_at: now - 321, tags: []},
        viewer
      )
    )
  } finally {
    relay.close()
  }
  await signUp(page, nip19.nsecEncode(viewer))
  await page.goto(`/search/${query}`)
  await expect(page.getByText("No matching posts found")).toBeVisible({timeout: 15000})
  await page.getByRole("button", {name: "Search older posts"}).click()
  await expect(
    page
      .locator('#main-content [data-testid="feed-item"]')
      .filter({hasText: `${query} older match`})
  ).toBeVisible({timeout: 15000})
})
