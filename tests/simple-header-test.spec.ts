import {test, expect} from "@playwright/test"

test.describe("Simple header test", () => {
  test("Header auto-hide on home and search", async ({page}) => {
    // Set mobile viewport
    await page.setViewportSize({width: 375, height: 667})

    // Capture console logs
    page.on("console", (msg) => {
      if (msg.text().includes("[Header]")) {
        console.log(msg.text())
      }
    })

    // Test home page
    console.log("\n=== HOME PAGE ===")
    await page.goto("/")
    await page.waitForTimeout(1000)

    // Add content to home scrollable
    const homeScrollable = await page.locator("[data-scrollable]").first()
    await homeScrollable.evaluate((el) => {
      for (let i = 0; i < 50; i++) {
        const div = document.createElement("div")
        div.style.height = "100px"
        div.textContent = `Home content ${i}`
        el.appendChild(div)
      }
    })

    // Scroll down
    await homeScrollable.evaluate((el) => {
      el.scrollTop = 200
      el.dispatchEvent(new Event("scroll"))
    })
    await page.waitForTimeout(500)

    const homeHeader = await page.locator("header").first()
    const homeTransform = await homeHeader.evaluate(
      (el) => window.getComputedStyle(el).transform
    )
    console.log("Home header after scroll:", homeTransform)
    expect(homeTransform).toContain("matrix")

    // Navigate to search
    console.log("\n=== SEARCH PAGE ===")
    await page.goto("/search")
    await page.waitForTimeout(1000)

    // Check which headers are visible
    const searchHeaders = await page.locator("header:visible")
    const searchHeaderCount = await searchHeaders.count()
    console.log("Visible headers on search page:", searchHeaderCount)

    // Find the main search header (should have the title)
    const mainSearchHeader = await page.locator('header:has-text("Search")').first()
    const isMainHeaderVisible = await mainSearchHeader.isVisible()
    console.log("Main search header visible:", isMainHeaderVisible)

    // Find the scrollable on search page
    const searchScrollables = await page.locator("[data-header-scroll-target]")
    const searchScrollableCount = await searchScrollables.count()
    console.log("Scrollables with data-header-scroll-target:", searchScrollableCount)

    // Add content to search scrollable
    const searchScrollable = await page.locator("[data-header-scroll-target]").first()
    await searchScrollable.evaluate((el) => {
      for (let i = 0; i < 50; i++) {
        const div = document.createElement("div")
        div.style.height = "100px"
        div.textContent = `Search content ${i}`
        el.appendChild(div)
      }
    })

    // Scroll down
    await searchScrollable.evaluate((el) => {
      el.scrollTop = 200
      el.dispatchEvent(new Event("scroll"))
    })
    await page.waitForTimeout(500)

    const searchTransform = await mainSearchHeader.evaluate(
      (el) => window.getComputedStyle(el).transform
    )
    console.log("Search header after scroll:", searchTransform)
    expect(searchTransform).toContain("matrix")
  })
})
