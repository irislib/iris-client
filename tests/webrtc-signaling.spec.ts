import {test, expect} from "@playwright/test"
import {bytesToHex} from "@noble/hashes/utils"
import {generateSecretKey} from "nostr-tools"
import {signIn} from "./auth.setup"

// Run WebRTC tests serially to avoid interference when multiple workers connect to same relay
test.describe.configure({mode: "serial"})

test.describe("WebRTC Signaling", () => {
  test("two sessions with same key should send and receive hellos", async ({browser}) => {
    // Generate test private key (hex format)
    const testPrivateKey = bytesToHex(generateSecretKey())
    console.log("Test private key:", testPrivateKey.slice(0, 16) + "...")

    // Create two contexts
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Collect console logs
    const logs1: string[] = []
    const logs2: string[] = []

    page1.on("console", (msg) => {
      const text = msg.text()
      logs1.push(text)
      console.log("[Page 1]", text)
    })

    page2.on("console", (msg) => {
      const text = msg.text()
      logs2.push(text)
      console.log("[Page 2]", text)
    })

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
    await page1.screenshot({path: "/tmp/page1-after-signin.png"})

    console.log("Page 2: Signing in...")
    await signIn(page2, testPrivateKey)
    await page2.screenshot({path: "/tmp/page2-after-signin.png"})

    console.log("Both pages loaded, waiting for WebRTC setup...")

    // Wait for WebRTC to initialize and hellos to be exchanged
    await page1.waitForTimeout(20000)

    console.log("\n=== Checking logs ===")
    console.log(`Page 1: ${logs1.length} log entries`)
    console.log(`Page 2: ${logs2.length} log entries`)

    // Filter for WebRTC/hello logs
    const webrtcLogs1 = logs1.filter(
      (log) => log.toLowerCase().includes("webrtc") || log.toLowerCase().includes("hello")
    )
    const webrtcLogs2 = logs2.filter(
      (log) => log.toLowerCase().includes("webrtc") || log.toLowerCase().includes("hello")
    )

    console.log("\n=== Page 1 WebRTC logs ===")
    webrtcLogs1.forEach((log) => console.log(log))
    console.log("\n=== Page 2 WebRTC logs ===")
    webrtcLogs2.forEach((log) => console.log(log))

    // Check that both pages sent hellos
    const page1SentHello = webrtcLogs1.some((log) => log.includes("hello"))
    const page2SentHello = webrtcLogs2.some((log) => log.includes("hello"))

    expect(page1SentHello).toBeTruthy()
    expect(page2SentHello).toBeTruthy()

    await context1.close()
    await context2.close()
  })
})
