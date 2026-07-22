import {expect, test, type Page, type TestInfo} from "@playwright/test"
import {signUp} from "./auth.setup"

interface JourneyMetrics {
  steps: Record<string, number>
  browser: Record<
    string,
    {
      domContentLoaded: number
      loadComplete: number
      transferredBytes: number
      decodedBytes: number
      longTasks: Array<{duration: number; startTime: number}>
      usedHeapBytes?: number
    }
  >
}

async function measureStep(
  metrics: JourneyMetrics,
  name: string,
  action: () => Promise<void>
) {
  const startedAt = Date.now()
  await test.step(name, action)
  metrics.steps[name] = Date.now() - startedAt
}

async function collectBrowserMetrics(
  page: Page,
  metrics: JourneyMetrics,
  snapshotName: string
) {
  metrics.browser[snapshotName] = await page.evaluate(() => {
    const navigation = performance.getEntriesByType(
      "navigation"
    )[0] as PerformanceNavigationTiming
    const resources = performance.getEntriesByType(
      "resource"
    ) as PerformanceResourceTiming[]
    const memory = (performance as Performance & {memory?: {usedJSHeapSize: number}})
      .memory

    return {
      domContentLoaded: Math.round(navigation?.domContentLoadedEventEnd ?? 0),
      loadComplete: Math.round(navigation?.loadEventEnd ?? 0),
      transferredBytes: resources.reduce((total, entry) => total + entry.transferSize, 0),
      decodedBytes: resources.reduce((total, entry) => total + entry.decodedBodySize, 0),
      longTasks:
        (
          window as typeof window & {
            __IRIS_JOURNEY_LONG_TASKS__?: Array<{
              duration: number
              startTime: number
            }>
          }
        ).__IRIS_JOURNEY_LONG_TASKS__ ?? [],
      ...(memory ? {usedHeapBytes: memory.usedJSHeapSize} : {}),
    }
  })
}

async function attachMetrics(testInfo: TestInfo, metrics: JourneyMetrics) {
  await testInfo.attach("user-journey-metrics", {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: "application/json",
  })
  console.log(`User journey metrics: ${JSON.stringify(metrics)}`)
}

test("core user journey stays responsive", async ({page}, testInfo) => {
  const metrics: JourneyMetrics = {steps: {}, browser: {}}
  const postContent = `Iris user journey ${Date.now()}`

  await page.addInitScript(() => {
    const target = window as typeof window & {
      __IRIS_JOURNEY_LONG_TASKS__?: Array<{duration: number; startTime: number}>
    }
    target.__IRIS_JOURNEY_LONG_TASKS__ = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        target.__IRIS_JOURNEY_LONG_TASKS__?.push({
          duration: Math.round(entry.duration),
          startTime: Math.round(entry.startTime),
        })
      }
    }).observe({type: "longtask", buffered: true})
  })

  await measureStep(metrics, "sign up", async () => {
    await signUp(page, "Journey User")
  })
  await collectBrowserMetrics(page, metrics, "signed up")

  await measureStep(metrics, "publish a post", async () => {
    await page.locator("#main-content").getByTestId("new-post-button").click()
    const dialog = page.getByRole("dialog")
    await dialog.getByPlaceholder("What's on your mind?").fill(postContent)
    await dialog.getByRole("button", {name: "Post"}).click()
    await expect(page).toHaveURL(/\/note/, {timeout: 15_000})
    await expect(page.getByText(postContent, {exact: true}).first()).toBeVisible()
  })

  await measureStep(metrics, "like the post", async () => {
    const post = page
      .locator('[data-testid="feed-item"]:visible')
      .filter({hasText: postContent})
      .first()
    await post.getByTestId("like-button").click()
    await expect(post.getByTestId("like-count")).toHaveText("1")
  })

  await measureStep(metrics, "restore the session", async () => {
    await page.reload()
    await expect(
      page.locator("#main-content").getByTestId("new-post-button")
    ).toBeVisible({timeout: 15_000})
    await expect(page.getByText(postContent, {exact: true}).first()).toBeVisible({
      timeout: 15_000,
    })
  })
  await collectBrowserMetrics(page, metrics, "restored session")

  await measureStep(metrics, "navigate primary sections", async () => {
    await page.getByRole("link", {name: "Search"}).click()
    await expect(page).toHaveURL(/\/u$/)
    await page.getByRole("link", {name: "About"}).click()
    await expect(page).toHaveURL(/\/about$/)
    await page.getByRole("link", {name: "Home", exact: true}).click()
    await expect(page).toHaveURL(/\/$/)
  })

  await collectBrowserMetrics(page, metrics, "finished")
  await attachMetrics(testInfo, metrics)
})

test("startup recovers from corrupt user storage", async ({page}) => {
  await page.addInitScript(() => localStorage.setItem("user-storage", "{"))

  await page.goto("/")

  await expect(page.locator("#main-content")).toBeVisible({timeout: 10_000})
  await expect(page).toHaveTitle(/iris/i)
})
