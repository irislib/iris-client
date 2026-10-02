import {expect, test} from "@playwright/test"
import {finalizeEvent, generateSecretKey, nip19} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"

test.skip(usingBuiltDist, "custom relay routing is configured through source modules")

test("profile discovery and nevent hints recover data absent from saved relays", async ({
  page,
}) => {
  const secret = generateSecretKey()
  const now = Math.floor(Date.now() / 1000)
  const profile = finalizeEvent(
    {
      kind: 0,
      tags: [],
      created_at: now,
      content: JSON.stringify({name: "Found through metadata directory"}),
    },
    secret
  )
  const post = finalizeEvent(
    {
      kind: 1,
      tags: [],
      created_at: now,
      content: "Found through the relay in this post link",
    },
    secret
  )
  const primary = await startNostrRelay({port: 0})
  const directory = await startNostrRelay({port: 0, initialEvents: [profile]})
  const authorRelay = await startNostrRelay({port: 0, initialEvents: [post]})
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, primary.port)
    await signUp(page, "Lookup test")
    const nevent = nip19.neventEncode({
      id: post.id,
      relays: [authorRelay.url],
      author: post.pubkey,
    })
    await page.evaluate(async (directoryUrl) => {
      const {nostr} = await import("/src/utils/nostrClient.ts")
      nostr().discoveryRelayUrls = [directoryUrl]
      nostr().enableRelayHints = true
      nostr().enableOutboxModel = false
    }, directory.url)
    await page.getByPlaceholder("Search", {exact: true}).first().fill(nevent)
    await expect(page.getByText(post.content, {exact: true}).first()).toBeVisible()
    await expect(
      page.getByText("Found through metadata directory", {exact: true}).first()
    ).toBeVisible()
  } finally {
    await Promise.all([primary.close(), directory.close(), authorRelay.close()])
  }
})
