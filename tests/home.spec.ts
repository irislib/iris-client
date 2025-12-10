import {test, expect} from "@playwright/test"

test("home page loads", async ({page}) => {
  const startTime = Date.now()

  // Capture console logs
  page.on("console", (msg) => {
    const text = msg.text()
    if (text.includes("Negentropy") || text.includes("NIP-77")) {
      console.log("BROWSER:", text)
    }
  })

  await page.goto("/")

  // Wait for app to render (title gets set)
  await expect(page).toHaveTitle(/iris/, {timeout: 5000})

  const loadTime = Date.now() - startTime
  console.log(`✅ App loaded in ${loadTime}ms`)

  // Verify main UI elements are visible
  await expect(page.locator("#main-content")).toBeVisible()
})
