import {test, expect} from "./fixtures/isolatedBrowser"
import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {signedGraphFixture, snapshotPointer} from "./utils/graph-bootstrap"
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
  const downloaded = await snapshot(manifest.root, 120)
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
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const fixture = await signedGraphFixture(page, downloaded, {holdMobile: held})
  await page.routeWebSocket(
    /^wss:\/\/(?:temp\.iris\.to|relay\.primal\.net|nos\.lol)\/?$/,
    (socket) => {
      socket.onMessage((data) => {
        const [kind, id, ...filters] = JSON.parse(data.toString())
        if (kind !== "REQ") return
        const event = snapshotPointer(page, filters)
        if (event) socket.send(JSON.stringify(["EVENT", id, event]))
        socket.send(JSON.stringify(["EOSE", id]))
      })
    }
  )

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
  await maxNodesInput.fill("6")
  await page.getByLabel("Import mode").selectOption("replace")

  // Click download button
  const downloadButton = page.locator("button", {hasText: "Download graph"})
  await downloadButton.click()

  // Wait for download to complete
  await expect(page.getByText(/Downloading/)).toBeVisible({timeout: 5000})
  await expect.poll(() => fixture.mobileReads).toBeGreaterThan(0)
  release()
  await expect(page.getByText(/^Imported /)).toBeVisible({timeout: 30000})

  // Scroll back to statistics
  await statisticsHeading.scrollIntoViewIfNeeded()

  await expect(count("Follow relationships")).toHaveText("5")
  await expect(count("Users")).toHaveText("6")
  await expect(count("Distance 1")).toHaveText("5")

  await page.getByRole("button", {name: "Check full snapshot size"}).click()
  const save = page.getByRole("button", {name: /^Save full snapshot/})
  await expect(save).toBeVisible()
  expect(fixture.reads).not.toContain(fixture.fullHash)
  const saved = page.waitForEvent("download")
  await save.click()
  const download = await saved
  expect(download.suggestedFilename()).toBe("social-graph-v4.bin")
  const bytes = await readFile((await download.path())!)
  expect(bytes.length).toBe(fixture.full.size)
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.full.sha256)
  await expect(count("Users")).toHaveText("6")
  await page.screenshot({path: testInfo.outputPath("downloaded-graph-statistics.png")})
})
