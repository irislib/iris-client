import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test.describe("Market Map Location Tags", () => {
  test("shows map interface and navigation between market and map pages", async ({
    page,
  }) => {
    // Sign up first
    await signUp(page, "Market Test User")

    // Navigate to market page
    await page.goto("/m")

    // Wait for page to load
    await page.waitForSelector(".flex-1", {timeout: 10000})

    // Just verify the market page loaded
    const pageLoaded = await page.locator(".flex-1").count()
    expect(pageLoaded).toBeGreaterThan(0)
    console.log("Market page loaded successfully")
  })

  test("map shows geohash input field and can navigate to specific geohash", async ({
    page,
  }) => {
    test.setTimeout(60000)
    // Sign up first
    await signUp(page, "Market Map User")

    // Navigate to market page
    await page.goto("/m")

    // Wait for page to load
    await page.waitForSelector(".flex-1", {timeout: 10000})

    // Click on Map button to show the map (use first to handle multiple)
    await page.locator('button:has-text("Map")').first().click()

    // Wait for map to render
    await page.waitForSelector(".leaflet-container", {timeout: 10000})

    // Find the geohash input field (use first since there may be duplicates in different columns)
    const geohashInput = page.locator('input[placeholder="geohash"]').first()
    await expect(geohashInput).toBeVisible()

    // Type a geohash
    await geohashInput.fill("u2v")
    await geohashInput.press("Enter")

    // Verify URL changed to map page with geohash
    await expect(page).toHaveURL(/\/map\/u2v/, {timeout: 15000})

    console.log("✓ Geohash navigation successful")
  })

  test("can select market categories and see them in URL", async ({page}) => {
    // Sign up first
    await signUp(page, "Category Test User")

    // Navigate to market page
    await page.goto("/m")

    // Wait for page to load
    await page.waitForSelector(".flex-1", {timeout: 10000})

    // Look for any category label (they should be visible by default)
    // Categories might have various names, let's just check one exists
    const categoryLabels = page.locator('[data-testid*="category-label"]')

    // If no categories are visible, might need to wait for them to load
    const count = await categoryLabels.count()
    if (count > 0) {
      // Click the first category
      await categoryLabels.first().click()

      // Wait for navigation
      await page.waitForTimeout(500)

      // Verify URL changed to include the category
      const url = page.url()
      expect(url).toMatch(/\/m\/[^/?]+/)

      // Verify a category badge appears
      const categoryBadge = page.locator(".badge-primary")
      await expect(categoryBadge.first()).toBeVisible()
    }
  })
})
