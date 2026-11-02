import {test, expect} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

test("can sign up and see home feed", async ({page}) => {
  const username = "Thread Test User"
  await signUp(page, username)

  await expect(page).toHaveURL(/\/$/)

  await expect(page.locator("#main-content").getByTestId("new-post-button")).toBeVisible()

  await expect(page.getByText(username, {exact: true})).toBeVisible()
})

for (const width of [390, 1280]) {
  test(`thread replies have no repeated history controls at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({width, height: 900})
    const viewer = generateSecretKey()
    const author = generateSecretKey()
    const now = Math.floor(Date.now() / 1000) - 60
    const root = finalizeEvent(
      {kind: 1, tags: [], content: "A question to start the thread", created_at: now},
      author
    )
    const reply = finalizeEvent(
      {
        kind: 1,
        tags: [["e", root.id, "", "root"]],
        content: "An answer with parent context",
        created_at: now + 1,
      },
      viewer
    )
    const nestedReply = finalizeEvent(
      {
        kind: 1,
        tags: [
          ["e", root.id, "", "root"],
          ["e", reply.id, "", "reply"],
        ],
        content: "A follow-up to the answer",
        created_at: now + 2,
      },
      author
    )
    const relay = await startNostrRelay({
      port: 0,
      initialEvents: [
        root,
        reply,
        nestedReply,
        finalizeEvent(
          {kind: 3, tags: [["p", getPublicKey(author)]], content: "", created_at: now},
          viewer
        ),
      ],
    })

    // Wait for the empty leaf reply feed to finish as well as the visible replies.
    const completedReplyQueries = new Set<string>()
    page.on("websocket", (socket) => {
      if (!socket.url().startsWith(relay.url)) return
      const queries = new Map<string, string[]>()
      socket.on("framesent", ({payload}) => {
        const [type, id, ...filters] = JSON.parse(String(payload))
        if (type === "REQ") {
          queries.set(
            id,
            filters.flatMap((filter) =>
              filter.kinds?.includes(1) ? (filter["#e"] ?? []) : []
            )
          )
        }
      })
      socket.on("framereceived", ({payload}) => {
        const [type, id] = JSON.parse(String(payload))
        if (type === "EOSE") {
          for (const reference of queries.get(id) ?? []) {
            completedReplyQueries.add(reference)
          }
        }
      })
    })

    try {
      await page.addInitScript((port) => {
        window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
      }, relay.port)
      await signUp(page, nip19.nsecEncode(viewer))
      await page.goto(`/${nip19.noteEncode(reply.id)}`)
      const main = page.locator("#main-content")
      for (const event of [root, reply, nestedReply]) {
        await expect(main.getByText(event.content, {exact: true})).toBeVisible()
      }
      await expect.poll(() => completedReplyQueries.has(nestedReply.id)).toBe(true)
      await page.screenshot({path: testInfo.outputPath("thread-replies.png")})
      await expect(
        main.getByRole("button", {name: "Load older posts", exact: true})
      ).toHaveCount(0)
      await expect(main.getByText("Loading older posts…", {exact: true})).toHaveCount(0)

      // The full thread still loads its reply tree automatically from the root.
      await page.goto(`/${nip19.noteEncode(root.id)}`)
      for (const event of [root, reply, nestedReply]) {
        await expect(main.getByText(event.content, {exact: true})).toBeVisible()
        await expect(main.getByText(event.content, {exact: true})).toHaveCount(1)
      }
      await expect(
        main.getByRole("button", {name: "Load older posts", exact: true})
      ).toHaveCount(0)
      await expect(main.getByText("Loading older posts…", {exact: true})).toHaveCount(0)
      await page.screenshot({path: testInfo.outputPath("thread-root.png")})
    } finally {
      await relay.close()
    }
  })
}
