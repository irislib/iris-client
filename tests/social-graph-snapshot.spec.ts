import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("social graph stats update after snapshot download", async ({page}) => {
  await signUp(page)

  // Navigate to social graph settings
  await page.goto("/settings/social-graph")

  // Wait for stats section to load
  const statisticsHeading = page.getByText("Statistics", {exact: true})
  await expect(statisticsHeading).toBeVisible({timeout: 20000})

  // Get follow relationships count via evaluate
  const getFollows = async () => {
    return page.evaluate(() => {
      const text = document.body.innerText
      const match = text.match(/Follow relationships\s+(\d+)/)
      return match ? Number(match[1]) : 0
    })
  }

  // Scroll down to download section
  await page.getByText("Download Snapshot").scrollIntoViewIfNeeded()

  // Set small maxNodes for fast download
  const maxNodesInput = page.locator('input[type="number"]').first()
  await maxNodesInput.fill("1000")

  // Click download button
  const downloadButton = page.locator("button", {hasText: "Download graph"})
  await downloadButton.click()

  // Wait for download to complete
  await expect(page.getByText(/Downloading/)).toBeVisible({timeout: 5000})
  await expect(page.getByText(/Downloaded:/)).toBeVisible({timeout: 30000})

  // Scroll back to statistics
  await statisticsHeading.scrollIntoViewIfNeeded()

  // Verify stats updated - downloaded graph should have follow relationships
  await expect(async () => {
    const newFollows = await getFollows()
    expect(newFollows).toBeGreaterThan(100)
  }).toPass({timeout: 5000})
})
