import {test, expect} from "./fixtures/isolatedBrowser"
import {SocialGraph} from "nostr-social-graph"
import manifest from "../src/assets/socialGraph.json" with {type: "json"}

test("social graph stats update after snapshot download", async ({page}, testInfo) => {
  const snapshot = async (root: string, follows: number) => {
    const graph = new SocialGraph(root)
    graph.handleEvent(
      {
        kind: 3,
        pubkey: root,
        created_at: 20,
        tags: Array.from({length: follows}, (_, index) => [
          "p",
          (index + 1).toString(16).padStart(64, "0"),
        ]),
        content: "",
        id: "",
        sig: "",
      },
      true,
      Infinity
    )
    return Buffer.from(await graph.toBinary())
  }
  const initial = await snapshot(manifest.root, 1)
  // The downloaded network has no follow path from the active root.
  const downloaded = await snapshot("f".repeat(64), 120)
  await page.addInitScript(() => {
    localStorage.setItem(
      "user-storage",
      JSON.stringify({
        version: 3,
        state: {
          publicKey: "",
          privateKey: "",
          relays: [],
          relayConfigs: [],
          ndkOutboxModel: false,
          autoConnectUserRelays: false,
        },
      })
    )
  })
  await page.route(/\/socialGraph(?:-[^/]+)?\.bin(?:\?.*)?$/, (route) =>
    route.request().resourceType() === "script"
      ? route.continue()
      : route.fulfill({body: initial, contentType: "application/octet-stream"})
  )
  let requested: URL | undefined
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("https://graph-api.iris.to/social-graph?**", async (route) => {
    requested = new URL(route.request().url())
    await held
    await route.fulfill({body: downloaded, contentType: "application/octet-stream"})
  })

  // Navigate to social graph settings
  await page.goto("/settings/social-graph")

  // Wait for stats section to load
  const statisticsHeading = page.getByText("Statistics", {exact: true})
  await expect(statisticsHeading).toBeVisible({timeout: 20000})

  const count = (label: string) =>
    page.getByText(label, {exact: true}).locator("..").locator("span").last()
  await expect(count("Follow relationships")).toHaveText("1")
  await expect(count("Users")).toHaveText("2")
  await expect(count("Distance 1")).toHaveText("1")

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
  await expect.poll(() => requested?.searchParams.get("maxNodes")).toBe("1000")
  expect(requested?.searchParams.get("format")).toBe("binary")
  release()
  await expect(page.getByText(/Downloaded:/)).toBeVisible({timeout: 30000})

  // Scroll back to statistics
  await statisticsHeading.scrollIntoViewIfNeeded()

  await expect(count("Follow relationships")).toHaveText("120")
  await expect(count("Users")).toHaveText("122")
  await expect(count("Distance 0")).toHaveText("1")
  await expect(page.getByText("Distance 1", {exact: true})).toHaveCount(0)
  await expect(count("No follow path")).toHaveText("121")
  await page.screenshot({path: testInfo.outputPath("downloaded-graph-statistics.png")})
})
