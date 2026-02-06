import {test, expect} from "@playwright/test"

// Skip: Debug test that requires actual popular posts on the relay
test.skip("popular feed debug", async ({page}) => {
  test.setTimeout(40000)

  const logs: string[] = []
  page.on("console", (msg) => {
    logs.push(msg.text())
  })

  await page.goto("/")

  // Wait for page to load
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(5000)

  console.log("\n=== Checking page state ===")

  // Check URL
  console.log("Current URL:", page.url())

  // Check if home page rendered
  const pageTitle = await page.title()
  console.log("Page title:", pageTitle)

  // Check what's visible on page
  const bodyText = await page.locator("body").textContent()
  console.log("Body contains 'Popular':", bodyText?.includes("Popular"))
  console.log("Body contains 'For You':", bodyText?.includes("For You"))

  // Check for feed items
  const feedItems = await page.locator('[data-testid="feed-item"]').count()
  console.log("Feed items:", feedItems)

  // Check for no posts message
  const noPostsCount = await page.locator("text=No popular posts found").count()
  console.log("No posts messages:", noPostsCount)

  // Check for loading state
  const loadingVisible = await page.locator("text=Loading").count()
  console.log("Loading messages:", loadingVisible)

  // Filter relevant logs
  const graphLogs = logs.filter(
    (l) => l.toLowerCase().includes("social") || l.includes("✅")
  )
  const authorLogs = logs.filter(
    (l) =>
      l.toLowerCase().includes("author") ||
      l.toLowerCase().includes("popular") ||
      l.toLowerCase().includes("filter")
  )
  const subLogs = logs.filter((l) => l.toLowerCase().includes("subscri"))

  console.log("\n=== Graph logs ===")
  graphLogs.slice(0, 10).forEach((l) => console.log(l))

  console.log("\n=== Author/Filter logs ===")
  authorLogs.slice(0, 10).forEach((l) => console.log(l))

  console.log("\n=== Subscription logs ===")
  subLogs.slice(0, 15).forEach((l) => console.log(l))

  console.log("\n=== All logs (last 20) ===")
  logs.slice(-20).forEach((l) => console.log(l))

  expect(feedItems).toBeGreaterThan(0)
})
