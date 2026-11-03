import {test as base, expect} from "@playwright/test"
import {finalizeEvent, generateSecretKey} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"

const landscape = "https://media.example.test/landscape.png"
const portrait = "https://media.example.test/portrait.png"
const test = base.extend<{searchRelay: void}>({
  searchRelay: [
    async ({page}, use) => {
      const event = finalizeEvent(
        {
          kind: 1,
          content: `Nature photos from a walk\n${landscape} ${portrait}`,
          created_at: Math.floor(Date.now() / 1000) - 60,
          tags: [
            ["t", "nature"],
            ["imeta", "dim 1200x600", `url ${landscape}`],
          ],
        },
        generateSecretKey()
      )
      const relay = await startNostrRelay({port: 0, initialEvents: [event]})
      await page.addInitScript((port) => {
        window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
        localStorage.setItem(
          "search-storage",
          JSON.stringify({
            version: 1,
            state: {aiSearch: false, showEventsByUnknownUsers: true},
          })
        )
        const settings = JSON.parse(localStorage.getItem("settings-storage") || "{}")
        localStorage.setItem(
          "settings-storage",
          JSON.stringify({
            ...settings,
            version: 0,
            state: {...settings.state, imgproxy: {enabled: false}},
          })
        )
      }, relay.port)
      await page.route("https://media.example.test/*.png", (route) => {
        const wide = route.request().url() === landscape
        return route.fulfill({
          contentType: "image/svg+xml",
          body: `<svg xmlns="http://www.w3.org/2000/svg" width="${wide ? 1200 : 600}" height="${wide ? 600 : 1200}"><rect width="100%" height="100%" fill="${wide ? "#438a68" : "#638cc0"}"/></svg>`,
        })
      })
      try {
        await use()
      } finally {
        await relay.close()
      }
    },
    {auto: true},
  ],
})

// Keep the image requests in this fixture under Playwright's routing control.
test.use({serviceWorkers: "block"})

test("desktop search preserves the right sidebar and its saved hide/show control", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({width: 1440, height: 1000})
  await page.goto("/search/nature")
  const hide = page.getByRole("button", {name: "Hide right column"})
  const show = page.getByRole("button", {name: "Show right column"})
  await expect(hide).toBeVisible()
  await expect(page.getByRole("heading", {name: "Popular", exact: true})).toBeVisible()
  const post = page
    .getByTestId("feed-item")
    .filter({hasText: "Nature photos from a walk"})
    .first()
  await expect(post).toBeVisible()
  const header = page.locator("header").filter({hasText: 'Search: "nature"'}).first()
  const expectFullFeedWidth = async () => {
    await expect
      .poll(async () => {
        const feed = (await post.boundingBox())!
        const column = (await header.boundingBox())!
        return Math.abs(feed.x + feed.width - (column.x + column.width))
      })
      .toBeLessThanOrEqual(2)
  }
  for (const width of [1280, 1680, 1920]) {
    await page.setViewportSize({width, height: 1200})
    await expectFullFeedWidth()
  }
  await hide.click()
  await expect(show).toBeVisible()
  await expectFullFeedWidth()
  await page.reload()
  await expect(show).toBeVisible()
  await show.click()
  await expect(hide).toBeVisible()
  await page.setViewportSize({width: 1680, height: 1200})
  await expectFullFeedWidth()
  await page.screenshot({path: testInfo.outputPath("search-sidebar-restored.png")})
  await page.setViewportSize({width: 390, height: 844})
  await expect(hide).not.toBeVisible()
  await page.setViewportSize({width: 1440, height: 1000})
  await expect(hide).toBeVisible()
})

test("a long mobile search title stays above the tabs when connectivity changes", async ({
  page,
  context,
}, testInfo) => {
  // A live peer would correctly suppress the offline badge. Use only the local
  // relay and keep a result mounted so it reconnects when the browser comes online.
  await context.routeWebSocket(/^wss:\/\//, (socket) => socket.close())
  await page.setViewportSize({width: 320, height: 800})
  const query = "nature photos from a walk"
  await page.goto(`/search/${encodeURIComponent(query)}`)
  const header = page.locator("header").filter({hasText: `Search: "${query}"`})
  const tabs = page.getByRole("button", {name: "Posts", exact: true})
  const offline = header.getByRole("link", {name: "Offline"})
  await expect(page.getByText("Nature photos from a walk", {exact: true})).toBeVisible()
  await expect(offline).toBeHidden()
  const before = (await header.boundingBox())!
  await context.setOffline(true)
  await expect(offline).toBeVisible()
  const disconnected = (await header.boundingBox())!
  expect(disconnected.height).toBe(before.height)
  expect(disconnected.y + disconnected.height).toBeLessThanOrEqual(
    (await tabs.boundingBox())!.y
  )
  await page.screenshot({path: testInfo.outputPath("mobile-search-offline.png")})
  await context.setOffline(false)
  await expect(offline).toBeHidden()
  expect((await header.boundingBox())!.height).toBe(before.height)
})

for (const width of [1440, 390]) {
  test(`search photo carousel fits the active image at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({width, height: 1000})
    let releasePhoto!: () => void
    const photoReady = new Promise<void>((resolve) => {
      releasePhoto = resolve
    })
    await page.route(landscape, async (route) => {
      await photoReady
      await route.fallback()
    })
    await page.goto("/search/nature", {waitUntil: "domcontentloaded"})
    const post = page
      .getByTestId("feed-item")
      .filter({hasText: "Nature photos from a walk"})
      .first()
    await expect(post).toBeVisible()
    const photo = post.locator(`img[src="${landscape}"]`)
    const carousel = post.getByRole("group", {name: "Media carousel"})
    await expect(carousel).toBeVisible()
    const reservedFrame = await carousel.boundingBox()
    releasePhoto()
    await expect
      .poll(() => photo.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBe(1200)
    const frame = await carousel.boundingBox()
    expect(Math.abs(frame!.height - reservedFrame!.height)).toBeLessThan(1)
    const image = await photo.boundingBox()
    expect(frame!.height).toBeLessThanOrEqual(image!.width / 2 + 20)
    expect(image!.height / image!.width).toBeCloseTo(0.5, 1)
    await carousel.getByRole("button", {name: "Next media"}).click()
    const tallPhoto = post.locator(`img[src="${portrait}"]`)
    await expect
      .poll(() => tallPhoto.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBe(600)
    await expect
      .poll(async () => (await carousel.boundingBox())!.height)
      .toBeGreaterThan(frame!.height)
    expect((await carousel.boundingBox())!.height).toBeLessThanOrEqual(620)
    await carousel.getByRole("button", {name: "Previous media"}).click()
    await expect
      .poll(async () => (await carousel.boundingBox())!.height)
      .toBeLessThanOrEqual(frame!.height + 1)
    const dragImage = (await photo.boundingBox())!
    await page.mouse.move(
      dragImage.x + dragImage.width * 0.85,
      dragImage.y + dragImage.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      dragImage.x + dragImage.width * 0.15,
      dragImage.y + dragImage.height / 2,
      {steps: 12}
    )
    await page.mouse.up()
    await expect(tallPhoto).toHaveCount(1)
    await carousel.getByRole("button", {name: "Previous media"}).click()
    await expect(photo).toHaveCount(1)
    await page.screenshot({path: testInfo.outputPath(`search-media-${width}.png`)})
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width)
  })
}
