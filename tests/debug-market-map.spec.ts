import {test} from "@playwright/test"

// Debug utility test - skip in normal runs
test.skip("debug market map dots for Electronics category", async ({page}) => {
  // Capture console logs
  page.on("console", (msg) => {
    if (
      msg.text().includes("MarketFilters:") ||
      msg.text().includes("GeohashMapContent:") ||
      msg.text().includes("location")
    ) {
      console.log("CONSOLE:", msg.text())
    }
  })
  // Don't sign up - use default social graph to see market events
  // Go directly to Electronics category
  await page.goto("/m/Electronics")

  // Wait for page to load
  await page.waitForSelector(".flex-1", {timeout: 10000})

  // Wait a bit for events to start loading
  await page.waitForTimeout(3000)

  // Click on Map button to show the map (NOT the one in SearchTabSelector)
  // The market page has its own Categories/Map toggle buttons
  const mapButtons = page.locator('button:has-text("Map")')
  const count = await mapButtons.count()
  console.log(`Found ${count} Map buttons on page`)

  // Click the second Map button (the one for toggling map view, not navigation)
  if (count > 1) {
    await mapButtons.nth(1).click()
  } else {
    await mapButtons.first().click()
  }

  // Wait for map to render (should be visible on the same page)
  await page.waitForSelector(".leaflet-container:visible", {timeout: 10000})

  // Wait for events to load and be processed
  await page.waitForTimeout(5000)

  // Take screenshot
  await page.screenshot({path: "/tmp/market-electronics-map.png", fullPage: true})
  console.log("Screenshot saved to /tmp/market-electronics-map.png")

  // Check for green dots
  const greenDots = await page
    .locator('.leaflet-marker-pane circle[fill="#00ff00"]')
    .count()
  console.log(`Found ${greenDots} green dots on the map`)

  // Check all circles
  const allCircles = await page.locator(".leaflet-marker-pane circle").count()
  console.log(`Total circles in marker pane: ${allCircles}`)

  // Check if the map has any overlay elements
  const overlayElements = await page.locator(".leaflet-overlay-pane > *").count()
  console.log(`Overlay pane elements: ${overlayElements}`)

  // Check rectangles (geohash grid)
  const rectangles = await page.locator(".leaflet-overlay-pane path").count()
  console.log(`Grid rectangles: ${rectangles}`)

  // Log the current geohash value
  const geohashInput = page.locator('input[placeholder="geohash"]')
  const currentValue = await geohashInput.inputValue()
  console.log(`Current geohash input value: "${currentValue}"`)

  // Check if there's a hidden feed collecting events
  const hiddenFeed = await page.locator(".hidden Feed").count()
  console.log(`Hidden feed components: ${hiddenFeed}`)

  // Keep browser open to inspect
  await page.waitForTimeout(15000)
})
