import type {Page} from "@playwright/test"

export const freshGraphBootstrap = "https://graph-api.iris.to/social-graph/mobile**"

/** Tests of the pinned bundle must not silently use the changing live graph. */
export async function useBundledGraphFallback(page: Page) {
  await page.route(freshGraphBootstrap, (route) =>
    route.fulfill({status: 503, body: "Fixture uses the pinned fallback"})
  )
}
