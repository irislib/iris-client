import {expect, test} from "@playwright/test"
import {finalizeEvent, generateSecretKey, nip19} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"

test("profile and post lookups follow public relay hints and skip local addresses", async ({
  page,
}) => {
  test.skip(usingBuiltDist, "custom relay routing is configured through source modules")
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
  const publicPostRelay = "wss://post.example"
  const publicOutbox = "wss://outbox.example"
  const localHint = "ws://nas.local:4848"
  const privateHint = "wss://192.168.1.10:5051"
  const relayList = finalizeEvent(
    {
      kind: 10002,
      content: "",
      created_at: now,
      tags: [
        ["r", localHint],
        ["r", publicOutbox],
      ],
    },
    secret
  )
  const primary = await startNostrRelay({port: 0, initialEvents: [relayList]})
  const directory = await startNostrRelay({port: 0, initialEvents: [profile]})
  const authorRelay = await startNostrRelay({port: 0, initialEvents: [post]})
  try {
    // The worker receives the actual routing decisions. Send virtual hostnames to
    // controlled fixtures only after recording which destinations Iris chose.
    await page.addInitScript(
      ({port, fixtures}) => {
        window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
        const routed = new Set<string>()
        Object.assign(window, {routed})
        const send = Worker.prototype.postMessage
        Worker.prototype.postMessage = function (message, ...args) {
          const options = message?.subscribeOpts
          if (options?.relayUrls) {
            options.relayUrls = options.relayUrls.map((url: string) => {
              routed.add(url)
              return fixtures[url] ?? url
            })
          }
          return send.call(this, message, ...args)
        }
      },
      {
        port: primary.port,
        fixtures: {
          [publicPostRelay]: authorRelay.url,
          [publicOutbox]: primary.url,
          [localHint]: primary.url,
          [privateHint]: primary.url,
        },
      }
    )
    await signUp(page, "Lookup test")
    const nevent = nip19.neventEncode({
      id: post.id,
      relays: [privateHint, publicPostRelay],
      author: post.pubkey,
    })
    await page.evaluate(async (directoryUrl) => {
      const {nostr} = await import("/src/utils/nostrClient.ts")
      nostr().discoveryRelayUrls = [directoryUrl]
      nostr().enableRelayHints = true
      nostr().enableOutboxModel = true
    }, directory.url)
    await page.getByPlaceholder("Search", {exact: true}).first().fill(nevent)
    await expect(page.getByText(post.content, {exact: true}).first()).toBeVisible()
    await expect(
      page.getByText("Found through metadata directory", {exact: true}).first()
    ).toBeVisible()
    const routed = () =>
      page.evaluate(() => [...(window as Window & {routed: Set<string>}).routed])
    await expect.poll(routed).toContain(publicOutbox)
    const urls = await routed()
    expect(urls).toContain(publicPostRelay)
    expect(urls).not.toContain(localHint)
    expect(urls).not.toContain(privateHint)
  } finally {
    await Promise.all([primary.close(), directory.close(), authorRelay.close()])
  }
})

test("an explicitly configured local relay can serve a poll without dialing its advertised LAN relay", async ({
  page,
}) => {
  let privateRequests = 0
  const privateRelay = await startNostrRelay({
    port: 0,
    onRequest: () => {
      privateRequests++
    },
  })
  const poll = finalizeEvent(
    {
      kind: 1068,
      content: "Where should we meet?",
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["option", "a", "Park"],
        ["option", "b", "Library"],
        ["relay", privateRelay.url],
      ],
    },
    generateSecretKey()
  )
  const configured = await startNostrRelay({port: 0, initialEvents: [poll]})
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, configured.port)
    await page.goto(`/${nip19.noteEncode(poll.id)}`)
    await expect(page.getByText(poll.content, {exact: true}).first()).toBeVisible()
    await expect(
      page.getByText("Voting and results are unavailable on this poll’s relays.").first()
    ).toBeVisible()
    await expect(
      page.getByRole("button", {name: "Refresh results"}).first()
    ).toBeDisabled()
    expect(privateRequests).toBe(0)
  } finally {
    await Promise.all([configured.close(), privateRelay.close()])
  }
})
