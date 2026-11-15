import {expect, test as base, type Locator} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

const test = base.extend<{homeFeed: Locator}>({
  homeFeed: async ({page}, use) => {
    const viewer = generateSecretKey()
    const author = generateSecretKey()
    const now = Math.floor(Date.now() / 1000) - 60
    const relay = await startNostrRelay({
      port: 0,
      initialEvents: [
        finalizeEvent(
          {kind: 3, tags: [["p", getPublicKey(author)]], content: "", created_at: now},
          viewer
        ),
        ...Array.from({length: 16}, (_, i) =>
          finalizeEvent(
            {kind: 1, tags: [], content: `Home feed post ${i}`, created_at: now - i},
            author
          )
        ),
      ],
    })
    try {
      await page.addInitScript((port) => {
        window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
        localStorage.setItem(
          "settings-storage",
          JSON.stringify({
            version: 0,
            state: {appearance: {singleColumnLayout: false, showRightColumn: true}},
          })
        )
      }, relay.port)
      await signUp(page, nip19.npubEncode(getPublicKey(viewer)))
      const firstPost = page.getByText(/^Home feed post \d+$/).first()
      await expect(firstPost).toBeVisible()
      await use(firstPost.locator("xpath=ancestor::*[@data-header-scroll-target][1]"))
    } finally {
      await relay.close()
    }
  },
})

test.describe("Desktop", () => {
  test.use({viewport: {width: 1440, height: 900}})

  test("a saved two-column preference opens the regular home feed", async ({
    page,
    homeFeed,
  }, testInfo) => {
    const sidebar = page.getByTestId("desktop-sidebar")
    const layoutToggle = page.getByTitle(/^(Single|Two)-column layout$/)
    await expect(sidebar.getByTestId("sidebar-readonly-indicator")).toBeVisible()
    await expect(layoutToggle).toHaveCount(0)
    await expect(page.getByRole("button", {name: "Hide right column"})).toBeVisible()
    await homeFeed.evaluate((el) => el.scrollTo(0, 400))
    await expect.poll(() => homeFeed.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    const header = page.locator("header").first()
    await expect(header).toBeInViewport()
    await header.click()
    await expect.poll(() => homeFeed.evaluate((el) => el.scrollTop)).toBe(0)
    await page.screenshot({path: testInfo.outputPath("desktop-home.png")})

    await page.goto("/settings/appearance")
    await expect(page.getByText("Limited maximum width", {exact: true})).toBeVisible()
    await expect(page.getByText("Column layout", {exact: true})).toHaveCount(0)
    await expect(layoutToggle).toHaveCount(0)
  })
})

test.describe("Mobile", () => {
  test.use({viewport: {width: 390, height: 844}})

  test("the home header hides on scroll and stays fixed during a pull", async ({
    page,
    homeFeed,
  }, testInfo) => {
    const header = page.locator("header").first()
    await expect(header).toBeInViewport()
    await homeFeed.evaluate((el) => el.scrollTo(0, 400))
    await expect(header).not.toBeInViewport()
    await homeFeed.evaluate((el) => el.scrollTo(0, 0))
    await expect(header).toBeInViewport({ratio: 1})

    const initialPosition = await header.boundingBox()
    await homeFeed.evaluate((el) => {
      for (const [type, clientY] of [
        ["touchstart", 100],
        ["touchmove", 200],
      ] as const) {
        const touch = new Touch({identifier: 1, target: el, clientY})
        el.dispatchEvent(new TouchEvent(type, {bubbles: true, touches: [touch]}))
      }
    })
    const indicator = page.getByAltText("Loading...", {exact: true})
    await expect(indicator).toBeVisible()
    expect(await header.boundingBox()).toEqual(initialPosition)
    await homeFeed.dispatchEvent("touchend")
    await expect(indicator).toBeHidden()
    await page.screenshot({path: testInfo.outputPath("mobile-home.png")})
  })
})
