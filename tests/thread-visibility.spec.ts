import {expect, test} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"

test.skip(
  usingBuiltDist,
  "controls delayed social-graph hydration through source modules"
)

test("mounted replies and counts recover when the social graph arrives later", async ({
  page,
}) => {
  const viewer = generateSecretKey()
  const author = generateSecretKey()
  const now = Math.floor(Date.now() / 1000) - 60
  const post = finalizeEvent(
    {kind: 1, tags: [], content: "Thread before graph hydration", created_at: now},
    viewer
  )
  const reply = finalizeEvent(
    {
      kind: 1,
      tags: [["e", post.id, "", "root"]],
      content: "Reply from a late-discovered friend",
      created_at: now + 1,
    },
    author
  )
  const reaction = finalizeEvent(
    {kind: 7, tags: [["e", post.id]], content: "+", created_at: now + 2},
    author
  )
  const repost = finalizeEvent(
    {kind: 6, tags: [["e", post.id]], content: JSON.stringify(post), created_at: now + 3},
    author
  )
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [post, reply, reaction, repost],
  })
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
    await signUp(page, nip19.nsecEncode(viewer))
    await page.goto(`/${nip19.noteEncode(post.id)}`)
    await expect(page.getByText(post.content, {exact: true}).first()).toBeVisible()
    // Prove the reply has reached the mounted subscription before graph hydration.
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const {nostr} = await import("/src/utils/nostrClient.ts")
          return [...nostr().subscriptions.values()].some(
            (sub) =>
              sub.filters.some((f) => f["#e"]?.includes(id) && f.kinds?.includes(1)) &&
              sub.completion !== undefined
          )
        }, post.id)
      )
      .toBe(true)
    await expect(page.getByText(reply.content, {exact: true})).toHaveCount(0)
    await page.evaluate(async (pubkey) => {
      const {getSocialGraph} = await import("/src/utils/socialGraph.ts")
      const {useSocialGraphStore} = await import("/src/stores/socialGraph.ts")
      const graph = getSocialGraph()
      graph.addFollower(graph.getRoot(), pubkey)
      await graph.recalculateFollowDistances()
      useSocialGraphStore.getState().incrementVersion()
    }, getPublicKey(author))
    await expect(page.getByText(reply.content, {exact: true})).toBeVisible()
    await expect(
      page.getByRole("button", {name: "Reply", exact: true}).first()
    ).toHaveText("1")
    await expect(page.getByTestId("like-count").first()).toHaveText("1")
    await expect(
      page.getByRole("button", {name: "Repost", exact: true}).first()
    ).toHaveText("1")
    await page.evaluate(async (pubkey) => {
      const {getSocialGraph} = await import("/src/utils/socialGraph.ts")
      const {useSocialGraphStore} = await import("/src/stores/socialGraph.ts")
      const graph = getSocialGraph()
      graph.handleEvent({
        kind: 10000,
        pubkey: graph.getRoot(),
        tags: [["p", pubkey]],
        created_at: Math.floor(Date.now() / 1000) + 1,
        content: "",
      })
      useSocialGraphStore.getState().incrementMuteListVersion()
    }, getPublicKey(author))
    await expect(page.getByText(reply.content, {exact: true})).toHaveCount(0)
    await expect(page.getByTestId("like-count").first()).toHaveText("0")
  } finally {
    await relay.close()
  }
})
