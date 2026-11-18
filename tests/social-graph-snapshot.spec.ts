import {test, expect} from "./fixtures/isolatedBrowser"
import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {signedGraphFixture, snapshotPointer} from "./utils/graph-bootstrap"
import {SocialGraph} from "nostr-social-graph"
import {getEventHash} from "nostr-tools"
import manifest from "../src/assets/socialGraph.json" with {type: "json"}

test("social graph stats update after snapshot download", async ({page}, testInfo) => {
  const snapshot = async (root: string, follows: number) => {
    const graph = new SocialGraph(root)
    const event = {
      kind: 3,
      pubkey: root,
      created_at: 20,
      tags: Array.from({length: follows}, (_, index) => [
        "p",
        (index + 1).toString(16).padStart(64, "0"),
      ]),
      content: "",
    }
    graph.handleEvent({...event, id: getEventHash(event), sig: ""}, true, Infinity)
    return Buffer.from(await graph.toBinary())
  }
  const initial = await snapshot(manifest.root, 1)
  const downloaded = await snapshot(manifest.root, 13_000)
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
    /^wss:\/\/(?:temp\.iris\.to|relay\.primal\.net)\/?$/,
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
  const maxNodesInput = page.getByLabel("Max nodes")
  await maxNodesInput.fill("6")
  await expect(page.getByLabel("Import mode")).toHaveValue("merge")
  await page.getByLabel("Import mode").selectOption("replace")

  // Click download button
  await page.getByRole("button", {name: "Check download sizes"}).click()
  const downloadButton = page.getByRole("button", {name: /^Download graph \(/})
  await expect(downloadButton).toContainText(/KB| MB| B/)
  expect(fixture.reads).not.toContain(fixture.fullHash)
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

  const afterInitialImport = fixture.mobileReads
  await maxNodesInput.fill("30000")
  await page.getByLabel("Import size (KiB)").fill("1")
  await page.getByLabel("Import mode").selectOption("save")
  const sliceDownload = page.waitForEvent("download")
  await downloadButton.click()
  const slice = await sliceDownload
  expect(slice.suggestedFilename()).toBe("iris-discovery-graph.bin")
  expect(fixture.mobileReads).toBe(afterInitialImport)
  const bounded = await readFile((await slice.path())!)
  expect(bounded.length).toBeLessThanOrEqual(1024)
  const partial = await SocialGraph.fromBinary(manifest.root, bounded)
  expect(partial.getFollowedByUser(manifest.root).size).toBeGreaterThan(0)
  expect(partial.getFollowedByUser(manifest.root).size).toBeLessThan(120)
  const fullRevision = (
    await SocialGraph.fromBinary(manifest.root, downloaded)
  ).getListRevision(manifest.root, 3)
  expect(fullRevision?.complete).toBe(true)
  expect(partial.getListRevision(manifest.root, 3)).toEqual({
    ...fullRevision,
    complete: false,
  })
  await expect(count("Users")).toHaveText("6")

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
  await page.getByLabel("Snapshot source").selectOption("local")
  await page.getByLabel("Max nodes").fill("3")
  await expect(page.getByText(/No download is needed/)).toBeVisible()
  const previousReads = fixture.reads.length
  const localSaved = page.waitForEvent("download")
  await page.getByRole("button", {name: "Save my graph"}).click()
  const local = await localSaved
  expect(local.suggestedFilename()).toBe("personal-social-graph.bin")
  const selectedLocal = await SocialGraph.fromBinary(
    manifest.root,
    await readFile((await local.path())!)
  )
  expect(selectedLocal.getFollowedByUser(manifest.root).size).toBe(2)
  expect(fixture.reads.length).toBe(previousReads)
  await expect(count("Users")).toHaveText("6")
  await page.screenshot({path: testInfo.outputPath("downloaded-graph-statistics.png")})
})
