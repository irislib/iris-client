import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test.describe("Message Requests Tab", () => {
  test("stays on Requests tab after opening a request chat", async ({page}) => {
    await signUp(page, "Test User")

    // Seed a single incoming DM so the Requests tab has something to show.
    // This avoids relying on relay publish/receive in e2e, while still exercising
    // the real navigation + chat list UI.
    await page.evaluate(async () => {
      const raw = localStorage.getItem("user-storage")
      if (!raw) throw new Error("Missing user-storage")
      const parsed = JSON.parse(raw)
      const myPubKey = parsed?.state?.publicKey as string | undefined
      if (!myPubKey) throw new Error("Missing publicKey in user-storage")

      const otherPubKey = "b".repeat(64) // 64-char hex pubkey (not followed, not accepted)
      const nowMs = Date.now()
      const eventId = nowMs.toString(16).padStart(64, "0")

      const store = (
        window as unknown as {
          usePrivateMessagesStore?: {
            getState: () => {
              awaitHydration: () => Promise<void>
              upsert: (from: string, to: string, event: any) => Promise<void>
            }
          }
        }
      ).usePrivateMessagesStore?.getState?.()

      if (!store) {
        throw new Error("usePrivateMessagesStore not available on window")
      }

      await store.awaitHydration()
      await store.upsert(otherPubKey, myPubKey, {
        id: eventId,
        pubkey: otherPubKey,
        created_at: Math.floor(nowMs / 1000),
        kind: 14, // nostr-double-ratchet CHAT_MESSAGE_KIND
        tags: [["ms", String(nowMs)]],
        content: "Seed message request",
      })
    })

    await page.getByRole("link", {name: "Chats"}).click()
    await expect(page).toHaveURL(/\/chats/, {timeout: 15000})
    await expect(page.getByRole("button", {name: "All"})).toBeVisible({timeout: 15000})

    const requestsButton = page.getByRole("button", {name: /Requests/})
    await expect(requestsButton).toBeVisible({timeout: 15000})
    await expect(requestsButton.locator(".badge")).toBeVisible({timeout: 15000})

    await requestsButton.click()
    await expect(requestsButton).toHaveClass(/border-highlight/)

    // Click the seeded request chat.
    const privateChatLink = page.locator('a[href="/chats/chat"]').first()
    await expect(privateChatLink).toBeVisible({timeout: 15000})
    await privateChatLink.click()

    await expect(page).toHaveURL(/\/chats\/chat/, {timeout: 15000})

    // Regression: opening a request chat must not reset the chat list tab back to "All".
    await expect(requestsButton).toHaveClass(/border-highlight/)
  })
})
