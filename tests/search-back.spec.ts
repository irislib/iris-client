import {test, expect} from "@playwright/test"
import {finalizeEvent, generateSecretKey} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"

for (const layout of ["mobile", "desktop", "two columns"]) {
  test(`Back restores post search results and the reading position on ${layout}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({width: layout === "mobile" ? 390 : 1440, height: 800})
    const now = Math.floor(Date.now() / 1000) - 10
    const posts = Array.from({length: 18}, (_, i) =>
      finalizeEvent(
        {kind: 1, tags: [], content: `Garden journal entry ${i}.`, created_at: now - i},
        generateSecretKey()
      )
    )
    const semanticText = "We planted seedlings after the last frost."
    posts.push(
      finalizeEvent(
        {kind: 1, tags: [], content: semanticText, created_at: now},
        generateSecretKey()
      )
    )
    let firstPageRequests = 0
    const relay = await startNostrRelay({
      port: 0,
      initialEvents: posts,
      onRequest: (filters) => {
        firstPageRequests += filters.filter(
          (filter) => filter.search === "garden" && (filter.until ?? Infinity) >= now
        ).length
      },
    })
    try {
      await page.addInitScript(
        ({port, singleColumnLayout, pauseScoring}) => {
          window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
          localStorage.setItem(
            "settings-storage",
            JSON.stringify({
              version: 0,
              state: {appearance: {singleColumnLayout}},
            })
          )
          localStorage.setItem(
            "search-storage",
            JSON.stringify({
              version: 1,
              state: {
                aiSearch: true,
                searchModel: "browser",
                showEventsByUnknownUsers: true,
              },
            })
          )
          Object.defineProperty(window, "LanguageModel", {
            value: {
              availability: async () => "available",
              create: async () => ({
                destroy() {},
                async prompt(input: string, {signal}: {signal: AbortSignal}) {
                  const {posts, query} = JSON.parse(input)
                  if (!posts.length) performance.mark(`plan-${query}`)
                  if (
                    pauseScoring &&
                    posts.length &&
                    !performance.getEntriesByName("scoring-held").length
                  ) {
                    performance.mark("scoring-held")
                    await new Promise<void>((_, reject) =>
                      signal.addEventListener(
                        "abort",
                        () => {
                          performance.mark("scoring-paused")
                          reject(signal.reason)
                        },
                        {once: true}
                      )
                    )
                  }
                  return JSON.stringify(
                    posts.length ? {scores: posts.map(() => 90)} : {terms: []}
                  )
                },
              }),
            },
          })
        },
        {
          port: relay.port,
          singleColumnLayout: layout !== "two columns",
          pauseScoring: layout === "mobile",
        }
      )
      await page.goto("/search/garden")
      const search = page.getByRole("textbox", {name: "Search posts", exact: true})
      const filters = page.getByRole("button", {name: /^Filters/})
      const rows = page.getByTestId("feed-item").filter({visible: true})
      const plans = () =>
        page.evaluate(() => performance.getEntriesByName("plan-garden").length)
      await expect.poll(plans).toBe(1)
      const semantic = rows.filter({hasText: semanticText})
      if (layout === "mobile") {
        await expect
          .poll(() =>
            page.evaluate(() => performance.getEntriesByName("scoring-held").length)
          )
          .toBe(1)
        await expect(semantic).toHaveCount(0)
      } else {
        await expect(
          page.getByRole("button", {name: "Show all", exact: true})
        ).toHaveAttribute("aria-busy", "false")
      }
      expect(firstPageRequests).toBeGreaterThan(0)
      const originalRequests = firstPageRequests
      await filters.click()
      await search.fill("unfinished garden query")
      await rows.nth(9).scrollIntoViewIfNeeded()
      const text = rows
        .filter({hasText: "Garden journal entry"})
        .nth(14)
        .getByText(/Garden journal entry/)
      await text.scrollIntoViewIfNeeded()
      await expect(text).toBeInViewport()
      const anchor = await text.elementHandle()
      const position = () => anchor!.evaluate((el) => el.getBoundingClientRect().top)
      const top = await position()
      const order = () =>
        rows.evaluateAll((items) => items.map((el) => el.getAttribute("data-event-id")))
      const original = (await order()).slice(0, 15)
      await text.click()
      await expect(page).toHaveURL(/\/note1/)
      if (layout === "mobile") {
        await expect
          .poll(() =>
            page.evaluate(() => performance.getEntriesByName("scoring-paused").length)
          )
          .toBe(1)
        await page.getByRole("button", {name: "Go back"}).click()
      } else await page.goBack()
      await expect(page).toHaveURL(/\/search\/garden$/)
      await expect(search).toHaveValue("unfinished garden query")
      await expect(semantic).toBeVisible()
      await expect(filters).toHaveAttribute("aria-expanded", "true")
      expect(await anchor!.evaluate((el) => el.isConnected)).toBe(true)
      await expect.poll(position).toBeCloseTo(top, 0)
      expect((await order()).slice(0, 15)).toEqual(original)
      await page.screenshot({path: testInfo.outputPath("restored-search.png")})

      await search.fill("orchids")
      await search.press("Enter")
      await expect(page).toHaveURL(/\/search\/orchids$/)
      await expect(search).toHaveValue("orchids")
      await expect(filters).toHaveAttribute("aria-expanded", "false")
      await page.goBack()
      await expect(search).toHaveValue("garden")
      await expect(filters).toHaveAttribute("aria-expanded", "true")
      expect((await order()).slice(0, 15)).toEqual(original)
      expect(await plans()).toBe(1)
      expect(firstPageRequests).toBe(originalRequests)
    } finally {
      await relay.close()
    }
  })
}
