import {expect, test, type Page} from "@playwright/test"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"
import {startNostrRelay} from "../dev-relay/nostr-relay"

test.skip(!usingBuiltDist, "requires the production service worker")
async function post(page: Page, content: string) {
  await page.locator("#main-content").getByTestId("new-post-button").click()
  const dialog = page.getByRole("dialog")
  await dialog.getByPlaceholder("What's on your mind?").fill(content)
  await dialog.getByRole("button", {name: "Post", exact: true}).click()
  await page.waitForURL(/\/note[a-z0-9]+/, {timeout: 2000})
  await expect(page.getByText(content, {exact: true}).first()).toBeVisible()
}

test("a public post completes before its relay acknowledges delivery", async ({
  page,
  browser,
}) => {
  const acknowledgements: Array<() => void> = []
  const relay = await startNostrRelay({
    port: 0,
    acknowledgeEvent: (event, acknowledge) => {
      if (event.kind === 1) acknowledgements.push(acknowledge)
      else acknowledge()
    },
  })
  const readerContext = await browser.newContext()
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
    await signUp(page, "Silent relay writer")
    const content = `Already sent without an acknowledgement ${Date.now()}`
    await post(page, content)
    await expect.poll(() => acknowledgements.length).toBeGreaterThan(0)
    const reader = await readerContext.newPage()
    await reader.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
    await reader.goto(page.url())
    await expect(reader.getByText(content, {exact: true}).first()).toBeVisible()
    await expect(page.getByText(/Could not publish post/)).toHaveCount(0)
    acknowledgements.forEach((acknowledge) => acknowledge())
    await page.reload()
    await expect(page.getByText(content, {exact: true}).first()).toBeVisible()
  } finally {
    await readerContext.close()
    await page.close()
    await relay.close()
  }
})

test("saved account and queued post survive an offline reload and publish on reconnect", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(60000)
  const relay = await startNostrRelay({port: 0})
  const readerContext = await browser.newContext()
  for (const target of [context, readerContext]) {
    await target.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
  }
  try {
    await signUp(page, "Offline session")
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
    await page.reload()
    const before = await page.evaluate(
      () => JSON.parse(localStorage.getItem("user-storage")!).state.publicKey
    )
    await context.setOffline(true)
    const content = `Offline retained post ${Date.now()}`
    await post(page, content)
    const path = new URL(page.url()).pathname
    await page.reload({waitUntil: "domcontentloaded"})
    await expect(page.getByText(content, {exact: true}).first()).toBeVisible({
      timeout: 15000,
    })
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("user-storage")!).state.publicKey
      )
    ).toBe(before)
    await context.setOffline(false)
    const reader = await readerContext.newPage()
    await reader.goto(path)
    await expect(reader.getByText(content, {exact: true}).first()).toBeVisible({
      timeout: 15000,
    })
  } finally {
    await readerContext.close()
    await page.close()
    await relay.close()
  }
})
