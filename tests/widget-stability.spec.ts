import {expect, test} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"

test.skip(usingBuiltDist, "controls background graph updates through source modules")

test("Popular keeps posts, scroll and subscriptions during background graph updates", async ({
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
        content: `Stable widget post ${index}\n\nKeep this post in place while the network updates.`,
        created_at: now - index,
      },
      author
    )
  )
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [
      ...posts,
      ...posts.map((post) =>
        finalizeEvent(
          {kind: 7, tags: [["e", post.id]], content: "+", created_at: now},
          author
        )
      ),
      finalizeEvent(
        {kind: 3, tags: [["p", pubkey]], content: "", created_at: now},
        viewer
      ),
    ],
  })
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
    await signUp(page, nip19.npubEncode(getPublicKey(viewer)))
    const widget = page.getByRole("heading", {name: "Popular", exact: true}).locator("..")
    const postsInWidget = widget.getByText(/^Stable widget post/)
    await expect.poll(() => postsInWidget.count()).toBeGreaterThanOrEqual(10)
    const anchor = await postsInWidget.nth(5).elementHandle()
    await anchor!.scrollIntoViewIfNeeded()
    await page.screenshot({path: testInfo.outputPath("widgets-before.png")})
    const result = await anchor!.evaluate(async (element) => {
      const storePath = "/src/stores/socialGraph.ts"
      const clientPath = "/src/utils/nostrClient.ts"
      const [{useSocialGraphStore}, {nostr}] = await Promise.all([
        import(storePath),
        import(clientPath),
      ])
      let container = element.parentElement!
      while (container.parentElement && getComputedStyle(container).overflowY !== "auto")
        container = container.parentElement
      const before = {
        scroll: container.scrollTop,
        top: element.getBoundingClientRect().top,
      }
      const subscriptions = [...nostr().subscriptions.values()].filter((sub) =>
        sub.filters.some((filter) => filter.kinds?.includes(7))
      )
      const samples: {connected: boolean; scroll: number; top: number}[] = []
      for (let i = 0; i < 6; i++) {
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
      const current = new Set(nostr().subscriptions.values())
      return {
        before,
        samples,
        subscriptionsPreserved:
          subscriptions.length > 0 && subscriptions.every((sub) => current.has(sub)),
      }
    })
    expect(result.before.scroll).toBeGreaterThan(100)
    expect(result.samples.every((sample) => sample.connected)).toBe(true)
    for (const sample of result.samples) {
      expect(Math.abs(sample.scroll - result.before.scroll)).toBeLessThan(2)
      expect(Math.abs(sample.top - result.before.top)).toBeLessThan(2)
    }
    expect(result.subscriptionsPreserved).toBe(true)
    await expect(widget.getByText("Loading popular posts...")).toBeHidden()
    await page.screenshot({path: testInfo.outputPath("widgets-after.png")})

    // Stability must not freeze moderation: a new mute removes the author's posts.
    await page.evaluate(async (author) => {
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
        tags: [["p", author]],
        content: "",
        created_at: Math.floor(Date.now() / 1000),
      })
      useSocialGraphStore.getState().incrementMuteListVersion()
    }, pubkey)
    await expect(postsInWidget).toHaveCount(0)
  } finally {
    await relay.close()
  }
})

for (const surface of ["Follows", "Relevant people", "More from this author"]) {
  test(`${surface} keeps mounted recommendations during graph updates`, async ({
    page,
  }, testInfo) => {
    const viewer = generateSecretKey()
    const author = generateSecretKey()
    const listOwner = generateSecretKey()
    const pubkey = getPublicKey(author)
    const created_at = Math.floor(Date.now() / 1000) - 60
    const articles = Array.from({length: 3}, (_, index) =>
      finalizeEvent(
        {
          kind: 30023,
          tags: [
            ["d", `article-${index}`],
            ["title", `Article ${index}`],
          ],
          content: `Stable article ${index}`,
          created_at: created_at - index,
        },
        author
      )
    )
    const note = finalizeEvent(
      {kind: 1, tags: [], content: "Stable thread", created_at},
      author
    )
    const relay = await startNostrRelay({
      port: 0,
      initialEvents: [
        ...articles,
        note,
        finalizeEvent(
          {
            kind: 0,
            tags: [],
            content: JSON.stringify({name: "Stable Widget Author"}),
            created_at,
          },
          author
        ),
        finalizeEvent(
          {kind: 3, tags: [["p", getPublicKey(listOwner)]], content: "", created_at},
          viewer
        ),
        finalizeEvent(
          {kind: 3, tags: [["p", pubkey]], content: "", created_at},
          listOwner
        ),
      ],
    })
    try {
      await page.addInitScript((port) => {
        window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
      }, relay.port)
      await signUp(page, nip19.npubEncode(getPublicKey(viewer)))
      const targets = {
        Follows: nip19.npubEncode(getPublicKey(listOwner)),
        "Relevant people": nip19.noteEncode(note.id),
        "More from this author": nip19.naddrEncode({
          kind: 30023,
          pubkey,
          identifier: "article-0",
        }),
      }
      const target = targets[surface]
      await page.goto(`/${target}`)
      const widget = page.getByRole("heading", {name: surface, exact: true}).locator("..")
      const row = widget
        .getByText(
          surface === "More from this author"
            ? "Stable article 1"
            : "Stable Widget Author",
          {exact: true}
        )
        .first()
      await expect(row).toBeVisible()
      const handle = await row.elementHandle()
      const stayedMounted = await handle!.evaluate(async (element) => {
        const storePath = "/src/stores/socialGraph.ts"
        const {useSocialGraphStore} = await import(storePath)
        for (let i = 0; i < 4; i++) {
          useSocialGraphStore.getState().incrementVersion()
          useSocialGraphStore.getState().incrementMuteListVersion()
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
          if (!element.isConnected) return false
        }
        return true
      })
      expect(stayedMounted).toBe(true)
      await page.screenshot({path: testInfo.outputPath("stable-widget.png")})
    } finally {
      await relay.close()
    }
  })
}
