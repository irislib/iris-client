import {expect, test} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {Relay} from "nostr-tools/relay"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"

test.skip(usingBuiltDist, "controls background graph updates through source modules")

for (const surface of ["profile", "mobile profile", "latest", "adventure"]) {
  test(`${surface} preserves mounted posts and scroll during graph updates`, async ({
    page,
  }, testInfo) => {
    const viewer = generateSecretKey()
    const author = generateSecretKey()
    const pubkey = getPublicKey(author)
    const now = Math.floor(Date.now() / 1000) - 60
    const posts = Array.from({length: 40}, (_, index) =>
      finalizeEvent(
        {
          kind: 1,
          tags: [],
          content: `Stable feed post ${index}\n\nA few lines to read while the network updates.\n\nThe page should stay in place.`,
          created_at: now - index,
        },
        author
      )
    )
    const relay = await startNostrRelay({
      port: 0,
      initialEvents: [
        ...posts,
        finalizeEvent(
          {kind: 3, tags: [["p", pubkey]], content: "", created_at: now},
          viewer
        ),
      ],
    })
    try {
      if (surface === "mobile profile")
        await page.setViewportSize({width: 390, height: 844})
      await page.addInitScript((port) => {
        window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
      }, relay.port)
      await signUp(page, nip19.nsecEncode(viewer))
      await expect(page.getByRole("button", {name: "Latest", exact: true})).toBeVisible()
      if (surface.includes("profile")) {
        await page.goto(`/${nip19.npubEncode(pubkey)}`)
      } else {
        await page
          .getByRole("button", {
            name: surface === "latest" ? "Latest" : "Adventure",
            exact: true,
          })
          .click()
      }
      const rows = page.locator('#main-content [data-testid="feed-item"]:visible')
      await expect(rows.filter({hasText: "Stable feed post 0\n"}).first()).toBeVisible()
      await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(10)
      const anchor = await rows.nth(5).elementHandle()
      await anchor!.scrollIntoViewIfNeeded()
      await page.screenshot({path: testInfo.outputPath("before-graph-update.png")})
      const result = await anchor!.evaluate(async (element) => {
        const modulePath = "/src/stores/socialGraph.ts"
        const {useSocialGraphStore} = await import(modulePath)
        let container = element.parentElement!
        while (
          container.parentElement &&
          container.scrollHeight <= container.clientHeight
        )
          container = container.parentElement
        const before = {
          scroll: container.scrollTop,
          top: element.getBoundingClientRect().top,
        }
        const samples: {connected: boolean; scroll: number; top: number}[] = []
        for (let i = 0; i < 4; i++) {
          if (i % 2) useSocialGraphStore.getState().incrementMuteListVersion()
          else useSocialGraphStore.getState().incrementVersion()
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
          samples.push({
            connected: element.isConnected,
            scroll: container.scrollTop,
            top: element.getBoundingClientRect().top,
          })
        }
        return {before, samples}
      })
      expect(result.before.scroll).toBeGreaterThan(200)
      expect(result.samples.every((sample) => sample.connected)).toBe(true)
      for (const sample of result.samples) {
        expect(Math.abs(sample.scroll - result.before.scroll)).toBeLessThan(2)
        expect(Math.abs(sample.top - result.before.top)).toBeLessThan(2)
      }
      await page.screenshot({path: testInfo.outputPath("after-graph-update.png")})
    } finally {
      await relay.close()
    }
  })
}

test("visibility changes recover received posts and apply mutes without clearing read posts", async ({
  page,
}) => {
  const viewer = generateSecretKey()
  const friend = generateSecretKey()
  const discovered = generateSecretKey()
  const now = Math.floor(Date.now() / 1000) - 60
  const post = (key: Uint8Array, content: string, created_at: number) =>
    finalizeEvent({kind: 1, tags: [], content, created_at}, key)
  const anchorPost = post(friend, "Keep this already-read post mounted", now)
  const latePost = post(
    discovered,
    "Recover this post after discovering its author",
    now - 1
  )
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [
      finalizeEvent(
        {kind: 3, tags: [["p", getPublicKey(friend)]], content: "", created_at: now},
        viewer
      ),
    ],
  })
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
    await signUp(page, nip19.nsecEncode(viewer))
    await expect(page.getByRole("button", {name: "Adventure", exact: true})).toBeVisible()
    await page.evaluate(async () => {
      const modulePath = "/src/stores/feed.ts"
      const {useFeedStore} = await import(modulePath)
      useFeedStore.getState().saveFeedConfig("adventure", {excludeSeen: true})
    })
    await page.getByRole("button", {name: "Adventure", exact: true}).click()
    // Deliver only after mounting this feed so For You cannot mark the fixture seen.
    const publisher = await Relay.connect(relay.url)
    try {
      await publisher.publish(anchorPost)
      await publisher.publish(latePost)
    } finally {
      publisher.close()
    }
    const rows = page.locator('#main-content [data-testid="feed-item"]:visible')
    await expect(rows.filter({hasText: anchorPost.content})).toBeVisible()
    const anchor = await rows.filter({hasText: anchorPost.content}).elementHandle()
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const modulePath = "/src/utils/nostrClient.ts"
          const {nostr} = await import(modulePath)
          return [...nostr().subscriptions.values()].some(
            (sub) =>
              sub.filters.some(
                (filter) => filter.kinds?.includes(1) && !filter.authors
              ) && sub.completion !== undefined
          )
        })
      )
      .toBe(true)
    await expect(rows.filter({hasText: latePost.content})).toHaveCount(0)
    await page.evaluate(
      async ({friend, discovered, id}) => {
        const graphPath = "/src/utils/socialGraph.ts"
        const storePath = "/src/stores/socialGraph.ts"
        const cachePath = "/src/utils/memcache.ts"
        const [{getSocialGraph}, {useSocialGraphStore}, {addSeenEventId}] =
          await Promise.all([import(graphPath), import(storePath), import(cachePath)])
        addSeenEventId(id)
        const graph = getSocialGraph()
        graph.addFollower(friend, discovered)
        await graph.recalculateFollowDistances()
        useSocialGraphStore.getState().incrementVersion()
      },
      {
        friend: getPublicKey(friend),
        discovered: getPublicKey(discovered),
        id: anchorPost.id,
      }
    )
    await expect(rows.filter({hasText: latePost.content})).toBeVisible()
    expect(await anchor!.evaluate((element) => element.isConnected)).toBe(true)
    await page.evaluate(async (pubkey) => {
      const graphPath = "/src/utils/socialGraph.ts"
      const storePath = "/src/stores/socialGraph.ts"
      const [{getSocialGraph}, {useSocialGraphStore}] = await Promise.all([
        import(graphPath),
        import(storePath),
      ])
      const graph = getSocialGraph()
      graph.handleEvent({
        kind: 10000,
        pubkey: graph.getRoot(),
        tags: [["p", pubkey]],
        created_at: Math.floor(Date.now() / 1000) + 1,
        content: "",
      })
      useSocialGraphStore.getState().incrementMuteListVersion()
    }, getPublicKey(discovered))
    await expect(rows.filter({hasText: latePost.content})).toHaveCount(0)
    expect(await anchor!.evaluate((element) => element.isConnected)).toBe(true)
  } finally {
    await relay.close()
  }
})
