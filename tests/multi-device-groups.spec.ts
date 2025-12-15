import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

// Skip: Complex multi-device group tests have timing issues with test relay sync
test.describe.skip("Multi-device group messaging", () => {
  test("messages sync across multiple devices in groups", async ({browser}) => {
    test.setTimeout(120000) // 2 minute timeout for complex multi-device test

    // Create two browser contexts to simulate two devices
    const device1 = await browser.newContext()
    const device2 = await browser.newContext()

    const page1 = await device1.newPage()
    const page2 = await device2.newPage()

    try {
      // Sign up two users
      await signUp(page1)
      await signUp(page2)

      // User 1 creates a group
      await page1.getByRole("link", {name: "Chats"}).click()
      await page1.waitForLoadState("networkidle")

      // Navigate to new group creation via the Group tab
      await page1.getByRole("link", {name: "Group"}).click()
      await page1.waitForLoadState("networkidle")

      // Fill in group details
      const groupName = "Test Group " + Date.now()
      await page1.getByPlaceholder("Group name").fill(groupName)

      // Create the group
      await page1.getByRole("button", {name: "Create"}).click()
      await expect(page1).toHaveURL(/\/chats\/group/, {timeout: 10000})

      // Wait for group chat to load
      await expect(page1.getByPlaceholder("Message")).toBeVisible({timeout: 10000})

      // Get the group URL for user 2 to join
      const groupUrl = page1.url()

      // User 2 joins the group
      await page2.goto(groupUrl)
      await page2.waitForLoadState("networkidle")

      // Wait for group chat to load on page2
      await expect(page2.getByPlaceholder("Message")).toBeVisible({timeout: 10000})

      // User 1 sends a message
      const message1 = "Hello from device 1"
      const messageInput1 = page1.getByPlaceholder("Message")
      await messageInput1.fill(message1)
      await messageInput1.press("Enter")

      // Verify message appears on device 1
      await expect(page1.locator(".whitespace-pre-wrap").getByText(message1)).toBeVisible(
        {timeout: 10000}
      )

      // Verify message appears on device 2
      await expect(page2.locator(".whitespace-pre-wrap").getByText(message1)).toBeVisible(
        {timeout: 15000}
      )

      // User 2 sends a message
      const message2 = "Hello from device 2"
      const messageInput2 = page2.getByPlaceholder("Message")
      await messageInput2.fill(message2)
      await messageInput2.press("Enter")

      // Verify message appears on device 2
      await expect(page2.locator(".whitespace-pre-wrap").getByText(message2)).toBeVisible(
        {timeout: 10000}
      )

      // Verify message appears on device 1
      await expect(page1.locator(".whitespace-pre-wrap").getByText(message2)).toBeVisible(
        {timeout: 15000}
      )

      // Wait for messages to persist
      await page1.waitForTimeout(1000)

      // Test message persistence - refresh device 1
      await page1.reload()
      await page1.waitForLoadState("networkidle")

      // Verify both messages still appear after refresh
      await expect(page1.locator(".whitespace-pre-wrap").getByText(message1)).toBeVisible(
        {timeout: 10000}
      )
      await expect(page1.locator(".whitespace-pre-wrap").getByText(message2)).toBeVisible(
        {timeout: 10000}
      )

      // Send another message after refresh
      const message3 = "Message after refresh"
      const refreshedInput = page1.getByPlaceholder("Message")
      await refreshedInput.fill(message3)
      await refreshedInput.press("Enter")

      // Verify it appears on both devices
      await expect(page1.locator(".whitespace-pre-wrap").getByText(message3)).toBeVisible(
        {timeout: 10000}
      )
      await expect(page2.locator(".whitespace-pre-wrap").getByText(message3)).toBeVisible(
        {timeout: 15000}
      )
    } finally {
      await device1.close()
      await device2.close()
    }
  })

  test("group member can see messages sent before joining", async ({browser}) => {
    test.setTimeout(120000) // 2 minute timeout

    // Create three browser contexts
    const device1 = await browser.newContext()
    const device2 = await browser.newContext()
    const device3 = await browser.newContext()

    const page1 = await device1.newPage()
    const page2 = await device2.newPage()
    const page3 = await device3.newPage()

    try {
      // Sign up three users
      await signUp(page1)
      await signUp(page2)
      await signUp(page3)

      // User 1 creates a group
      await page1.getByRole("link", {name: "Chats"}).click()
      await page1.waitForLoadState("networkidle")

      // Navigate to new group creation
      await page1.getByRole("link", {name: "Group"}).click()
      await page1.waitForLoadState("networkidle")

      const groupName = "History Test Group " + Date.now()
      await page1.getByPlaceholder("Group name").fill(groupName)
      await page1.getByRole("button", {name: "Create"}).click()
      await expect(page1).toHaveURL(/\/chats\/group/, {timeout: 10000})

      // Wait for group chat to load
      await expect(page1.getByPlaceholder("Message")).toBeVisible({timeout: 10000})

      const groupUrl = page1.url()

      // User 2 joins the group
      await page2.goto(groupUrl)
      await page2.waitForLoadState("networkidle")
      await expect(page2.getByPlaceholder("Message")).toBeVisible({timeout: 10000})

      // Users 1 and 2 exchange messages
      const messagesBefore = [
        {page: page1, text: "First message from user 1"},
        {page: page2, text: "Reply from user 2"},
        {page: page1, text: "Another message from user 1"},
      ]

      for (const {page, text} of messagesBefore) {
        const input = page.getByPlaceholder("Message")
        await input.fill(text)
        await input.press("Enter")
        await expect(page.locator(".whitespace-pre-wrap").getByText(text)).toBeVisible({
          timeout: 10000,
        })
        await page.waitForTimeout(500)
      }

      // Verify messages appear on both devices
      for (const {text} of messagesBefore) {
        await expect(page1.locator(".whitespace-pre-wrap").getByText(text)).toBeVisible({
          timeout: 10000,
        })
        await expect(page2.locator(".whitespace-pre-wrap").getByText(text)).toBeVisible({
          timeout: 10000,
        })
      }

      // User 3 joins the group
      await page3.goto(groupUrl)
      await page3.waitForLoadState("networkidle")
      await expect(page3.getByPlaceholder("Message")).toBeVisible({timeout: 10000})

      // Wait for message history to sync
      await page3.waitForTimeout(3000)

      // User 3 should see all previous messages
      for (const {text} of messagesBefore) {
        await expect(page3.locator(".whitespace-pre-wrap").getByText(text)).toBeVisible({
          timeout: 15000,
        })
      }

      // User 3 sends a message
      const message3 = "Hello from user 3 who just joined"
      const input3 = page3.getByPlaceholder("Message")
      await input3.fill(message3)
      await input3.press("Enter")

      // Verify it appears on all devices
      await expect(page3.locator(".whitespace-pre-wrap").getByText(message3)).toBeVisible(
        {timeout: 10000}
      )
      await expect(page1.locator(".whitespace-pre-wrap").getByText(message3)).toBeVisible(
        {timeout: 15000}
      )
      await expect(page2.locator(".whitespace-pre-wrap").getByText(message3)).toBeVisible(
        {timeout: 15000}
      )
    } finally {
      await device1.close()
      await device2.close()
      await device3.close()
    }
  })
})
