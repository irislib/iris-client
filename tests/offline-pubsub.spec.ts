import {expect, test, type Page} from "@playwright/test"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"

test.skip(!usingBuiltDist, "requires the production service worker")
async function post(page: Page, content: string) {
  await page.locator("#main-content").getByTestId("new-post-button").click()
  const dialog = page.getByRole("dialog")
  await dialog.getByPlaceholder("What's on your mind?").fill(content)
  await dialog.getByRole("button", {name: "Post", exact: true}).click()
  await page.waitForURL(/\/note[a-z0-9]+/)
  await expect(page.getByText(content, {exact: true}).first()).toBeVisible()
}

test("saved account and queued post survive an offline reload and publish on reconnect", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(60000)
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
  const readerContext = await browser.newContext()
  if (process.env.IRIS_E2E_LOCAL_RELAY === "true") {
    await readerContext.addInitScript(() => {
      window.__HTREE_SERVER_URL__ = "http://127.0.0.1:7777"
    })
  }
  const reader = await readerContext.newPage()
  try {
    await reader.goto(path)
    await expect(reader.getByText(content, {exact: true}).first()).toBeVisible({
      timeout: 15000,
    })
  } finally {
    await readerContext.close()
  }
})
