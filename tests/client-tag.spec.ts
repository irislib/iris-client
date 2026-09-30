import {test, expect, type Page} from "@playwright/test"
import {finalizeEvent, getPublicKey, type Event, type EventTemplate} from "nostr-tools"

async function createPost(page: Page, content: string) {
  await page.goto("/")
  await page.locator("#main-content").getByTestId("new-post-button").click()
  const dialog = page.getByRole("dialog")
  await dialog.getByPlaceholder("What's on your mind?").fill(content)
  await dialog.getByRole("button", {name: "Post", exact: true}).click()
  await page.waitForURL(/\/note[a-z0-9]+/)
  await expect(page.getByText(content, {exact: true}).first()).toBeVisible()
}

test("public activity uses the standard iris tag and honors the persisted opt-out", async ({
  page,
}, testInfo) => {
  const signedEvents: EventTemplate[] = []
  const signerKey = new Uint8Array(32).fill(17)
  await page.exposeFunction("captureSignedEvent", (event: EventTemplate) => {
    signedEvents.push(event)
    return finalizeEvent(event, signerKey)
  })
  await page.addInitScript((pubkey) => {
    window.__HTREE_SERVER_URL__ = "http://127.0.0.1:7777"
    if (!localStorage.getItem("user-storage")) {
      localStorage.setItem(
        "user-storage",
        JSON.stringify({
          state: {
            publicKey: pubkey,
            privateKey: "",
            nip07Login: true,
            linkedDevice: false,
            relayConfigs: [{url: "ws://127.0.0.1:7777", read: true, write: true}],
            ndkOutboxModel: false,
            autoConnectUserRelays: false,
          },
          version: 3,
        })
      )
      // Existing users have content settings without the new preference.
      localStorage.setItem(
        "settings-storage",
        JSON.stringify({
          state: {
            content: {
              blurNSFW: false,
              showLikes: true,
              showReposts: true,
              showReplies: true,
              showZaps: true,
              showReactionsBar: true,
              showReactionCounts: true,
              showReactionCountsInStandalone: true,
            },
          },
          version: 0,
        })
      )
    }
    window.nostr = {
      getPublicKey: async () => pubkey,
      signEvent: async (event) => {
        return (
          window as Window & {
            captureSignedEvent: (event: unknown) => Promise<Event>
          }
        ).captureSignedEvent(event)
      },
      getRelays: async () => ({}),
    }
  }, getPublicKey(signerKey))

  await createPost(page, "Client attribution enabled")
  const post = signedEvents.find(
    (event) => event.content === "Client attribution enabled"
  )!
  expect(post.tags.filter((tag) => tag[0] === "client")).toEqual([["client", "iris"]])

  const postElement = page
    .locator('[data-testid="feed-item"]:visible')
    .filter({hasText: "Client attribution enabled"})
    .first()
  await postElement.getByTestId("like-button").click()
  await expect.poll(() => signedEvents.some((event) => event.kind === 7)).toBe(true)
  expect(signedEvents.find((event) => event.kind === 7)!.tags).toContainEqual([
    "client",
    "iris",
  ])

  await page.getByPlaceholder("Write your reply...").fill("Attributed reply")
  await page.getByRole("button", {name: "Reply", exact: true}).last().click()
  await expect
    .poll(() => signedEvents.some((event) => event.content === "Attributed reply"))
    .toBe(true)
  expect(
    signedEvents.find((event) => event.content === "Attributed reply")!.tags
  ).toContainEqual(["client", "iris"])

  await page.goto("/settings/content")
  const toggle = page.getByRole("checkbox", {name: "Show Iris on my public activity"})
  await expect(toggle).toBeChecked()
  await page.screenshot({
    path: testInfo.outputPath("content-settings.png"),
    fullPage: true,
  })
  await toggle.uncheck()
  await page.reload()
  await expect(toggle).not.toBeChecked()

  await createPost(page, "Client attribution disabled")
  expect(
    signedEvents
      .find((event) => event.content === "Client attribution disabled")!
      .tags.filter((tag) => tag[0] === "client")
  ).toEqual([])

  await page.goto("/settings/content")
  await toggle.check()
  await createPost(page, "Client attribution restored")
  expect(
    signedEvents.find((event) => event.content === "Client attribution restored")!.tags
  ).toContainEqual(["client", "iris"])
})
