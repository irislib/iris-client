import {expect, test} from "@playwright/test"
import {nhashDecode, toHex} from "@hashtree/core"
import {loadEnv} from "vite"

test.use({serviceWorkers: "block"})
test.skip(
  ![process.env.IRIS_E2E_BUILT_DIST, process.env.IRIS_E2E_BUILT].some((value) =>
    ["true", "1"].includes(value || "")
  ),
  "Verify remote search configuration in the production bundle"
)

test("cold people search requests its public index without cached profiles", async ({
  page,
  context,
}) => {
  const config = loadEnv("production", process.cwd())
  const snapshot = nhashDecode(config.VITE_PROFILE_SEARCH_INDEX_SNAPSHOT)
  const hash = toHex(snapshot.hash)
  const requests: string[] = []
  // Keep external services out of this regression check. The real worker must
  // request its pinned snapshot; candidate replies are never intercepted.
  await context.routeWebSocket(/^(?:wss?:\/\/)/, () => {})
  await context.route("https://**/*", async (route) => {
    requests.push(route.request().url())
    await route.fulfill({status: 404, body: ""})
  })
  await page.setViewportSize({width: 390, height: 844})
  await page.goto("/u")
  await page.getByPlaceholder("Search people...").fill("ben")
  await expect.poll(() => requests).toContainEqual(expect.stringContaining(hash))
})
