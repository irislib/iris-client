import {test, expect} from "@playwright/test"

test.describe("Cashu Token Memo", () => {
  test("debug memo encoding and metadata persistence", async ({page}) => {
    // Capture ALL console messages
    const logs: string[] = []
    page.on("console", (msg) => {
      const text = msg.text()
      logs.push(`[${msg.type()}] ${text}`)
      console.log(`[BROWSER ${msg.type()}]:`, text)
    })

    // Load wallet - assume it has balance from previous use
    await page.goto("/wallet")
    await page.waitForSelector('button:has-text("SEND")', {timeout: 10000})

    const balanceText = await page.locator(".text-5xl").first().textContent()
    console.log("💰 Starting balance:", balanceText)

    // If no balance, skip test
    if (balanceText?.includes("0 bit")) {
      console.log("⚠️ No balance - skipping test")
      test.skip()
      return
    }

    // Test sending with memo
    await page.click('button:has-text("SEND")')
    await page.waitForTimeout(500)
    await page.click('button:has-text("Ecash")')
    await page.waitForTimeout(500)

    // Screenshot send dialog
    await page.screenshot({path: "/tmp/send-dialog.png"})

    // Enter amount
    const amountInput = page.locator('input[type="number"]').first()
    await amountInput.fill("1")

    // Enter note
    const sendNoteText = "Test memo 123"
    const noteInput = page.locator('input[placeholder*="What\'s this for"]')
    await noteInput.fill(sendNoteText)
    console.log("✏️ Entered note:", sendNoteText)

    // Screenshot before create
    await page.screenshot({path: "/tmp/before-create.png"})

    // Create token
    await page.click('button:has-text("Create Token")')

    // Wait for token
    await page.waitForSelector("textarea[readonly]", {timeout: 10000})
    await page.waitForTimeout(500)

    // Screenshot after create
    await page.screenshot({path: "/tmp/after-create.png"})

    // Get token
    const token = await page.locator("textarea[readonly]").inputValue()
    console.log("📦 Generated token:", token.substring(0, 80) + "...")

    // Decode
    const {getDecodedToken} = await import("@cashu/cashu-ts")
    const decoded = getDecodedToken(token)
    console.log("🔍 DECODED MEMO:", decoded.memo)
    console.log("🔍 DECODED KEYS:", Object.keys(decoded))

    if (!decoded.memo) {
      console.error("❌ MEMO NOT IN TOKEN!")
      console.log("Full token:", JSON.stringify(decoded, null, 2))
      console.log("📋 All console logs:")
      logs.forEach((l) => console.log(l))
      await page.screenshot({path: "/tmp/memo-fail.png"})
    }

    expect(decoded.memo).toBe(sendNoteText)

    // Close dialog
    await page.click('button:has-text("Done")')
    await page.waitForTimeout(1000)

    // Check history
    await page.screenshot({path: "/tmp/after-close.png"})

    const historyItem = page.locator(".bg-base-200").first()
    const historyText = await historyItem.textContent()
    console.log("📜 History text:", historyText)

    if (!historyText?.includes(sendNoteText)) {
      console.error("❌ MEMO NOT IN HISTORY!")
      await page.screenshot({path: "/tmp/history-no-memo.png"})
      console.log("📋 All logs:", logs.join("\n"))
    }

    expect(historyText).toContain(sendNoteText)
  })
})
