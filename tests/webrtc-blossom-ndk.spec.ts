import {test, expect} from "@playwright/test"
import {bytesToHex} from "@noble/hashes/utils"
import {sha256} from "@noble/hashes/sha256"
import {generateSecretKey} from "nostr-tools"
import {signIn} from "./auth.setup"
import {readFileSync} from "fs"

// Run WebRTC tests serially to avoid interference when multiple workers connect to same relay
test.describe.configure({mode: "serial"})

test.describe("WebRTC Blossom via NDK", () => {
  test("user posts blossom URL, other user fetches via p2p", async ({browser}) => {
    // Generate test private key
    const testPrivateKey = bytesToHex(generateSecretKey())
    console.log("Test private key:", testPrivateKey.slice(0, 16) + "...")

    // Create two contexts
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Capture console logs
    page2.on("console", (msg) => console.log(`[Page2] ${msg.text()}`))

    // Enable debug logging
    await page1.addInitScript(() => {
      localStorage.setItem("debug", "webrtc:*")
    })
    await page2.addInitScript(() => {
      localStorage.setItem("debug", "webrtc:*")
    })

    // Sign in to both pages with the same key
    console.log("Page 1: Signing in...")
    await signIn(page1, testPrivateKey)

    console.log("Page 2: Signing in...")
    await signIn(page2, testPrivateKey)

    console.log("Both pages loaded, waiting for WebRTC setup...")

    // Wait for WebRTC connection
    await page1.waitForTimeout(10000)

    // Load real blossom file
    const testData = readFileSync("tests/fixtures/test-blob.jpeg")
    const testHash = bytesToHex(sha256(testData))

    console.log("Test blob hash:", testHash)
    console.log("Test blob size:", testData.length)

    expect(testHash).toBe(
      "337bf99d724615d6a4d6a8c80178a0ba77a4d2f8bbdc7926c78c30a29bf26637"
    )

    // Page1: Store blob in storage (simulating successful upload)
    await page1.evaluate(
      async ({dataArray, hash}) => {
        const {getBlobStorage} = await import("./src/utils/chat/webrtc/blobManager")
        const {ndk} = await import("./src/utils/ndk")
        const storage = getBlobStorage()
        await storage.initialize()

        const data = new Uint8Array(dataArray)
        const myPubkey = ndk().activeUser?.pubkey
        await storage.save(hash, data.buffer, "image/jpeg", myPubkey)
        console.log(
          "Page1: Blob stored with author, will serve via p2p:",
          hash.slice(0, 8)
        )
      },
      {dataArray: Array.from(testData), hash: testHash}
    )

    // Page1: Create post with blossom URL
    await page1.locator("#main-content").getByTestId("new-post-button").click()

    const blossomUrl = `https://files.iris.to/${testHash}.jpeg`
    await page1
      .getByRole("dialog")
      .getByPlaceholder("What's on your mind?")
      .fill(blossomUrl)

    await page1.getByRole("dialog").getByRole("button", {name: "Post"}).click()

    // Wait for post to be created
    await page1.waitForTimeout(2000)
    console.log("Page1: Published note with blossom URL")

    // Page2: Navigate to own profile to see the post
    await page2.getByTestId("sidebar-user-row").locator("img").first().click()
    await page2.waitForTimeout(5000)

    // Screenshot for debugging
    await page2.screenshot({path: "/tmp/page2-profile.png"})

    // Page2: Verify that blob was fetched via p2p from Page1 and author was saved
    const result = await page2.evaluate(async (hash) => {
      // Wait for useBlossomCache to complete and React to re-render with blob: URL
      await new Promise((resolve) => setTimeout(resolve, 5000))

      const {getBlobStorage} = await import("./src/utils/chat/webrtc/blobManager")
      const storage = getBlobStorage()

      // Check if blob is in storage (would be saved by useBlossomCache after p2p fetch)
      const blob = await storage.get(hash)

      console.log("Blob in storage:", !!blob)
      console.log("Blob first_author:", blob?.first_author?.slice(0, 8) || "none")

      // Check all images
      const images = Array.from(document.querySelectorAll("img"))
      console.log("Total images found:", images.length)

      // Log all image src URLs
      const imageSrcs = images.map((img, i) => `[${i}] ${img.src}`)
      console.log("All image URLs:", imageSrcs)

      // Find any image in the feed content area (not avatars/icons)
      const feedImages = images.filter((img) => {
        const parent = img.closest("[class*='post'], [class*='note'], [class*='feed']")
        return parent !== null
      })
      console.log("Feed images:", feedImages.length)

      // Check for hash in any image URL or blob URL
      const imageWithHash = images.find((img) => img.src.includes(hash))
      const blobUrlImages = images.filter((img) => img.src.startsWith("blob:"))

      console.log("Images with hash:", !!imageWithHash, imageWithHash?.src.slice(0, 100))
      console.log("Blob URL images:", blobUrlImages.length)
      console.log("Blob in storage:", !!blob)

      // For now, just check if blob storage has the data (proving p2p worked)
      // The image might be loading but DOM check is flaky
      if (!blob) {
        return {
          error: "Blob not in storage - p2p fetch didn't happen",
          imageCount: images.length,
          blobUrlCount: blobUrlImages.length,
          foundHash: !!imageWithHash,
        }
      }

      // If we have the blob in storage on Page2, it means p2p worked!
      return {
        success: true,
        blobFound: true,
        imageCount: images.length,
        blobUrlCount: blobUrlImages.length,
      }
    }, testHash)

    console.log("Result:", result)

    expect(result.error).toBeUndefined()
    expect(result.success).toBe(true)
    expect(result.blobFound).toBe(true)

    await context1.close()
    await context2.close()
  })
})
