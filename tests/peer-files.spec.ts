import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"
import {FipsNode, generateIdentity, identityFromSecretKey} from "@fips/core"
import {WebSocketTransport} from "@fips/transport-websocket"
import {FipsNostrPubsubClient} from "nostr-pubsub"
import {
  HashtreeRuntimeEventStore,
  type HashtreeRuntimeState,
} from "@hashtree/nostr-pubsub"
import {MemoryStore, toHex} from "@hashtree/core"
import {finalizeEvent, generateSecretKey, nip19, Relay} from "nostr-tools"
import {randomBytes} from "node:crypto"
// Same real FIPS seed fixture used by Iris Social; no file or event storage in the seed.
import {
  startLocalFipsWebSocketSeed,
  type LocalFipsWebSocketSeed,
} from "./fixtures/localFipsWebSocketSeed"

test.setTimeout(90000)
test.skip(usingBuiltDist, "the peer harness imports app modules from the source server")
const relayUrl = process.env.IRIS_PEER_TEST_RELAY ?? "ws://127.0.0.1:7777"
let seed: LocalFipsWebSocketSeed
test.beforeAll(async () => {
  seed = await startLocalFipsWebSocketSeed()
})
test.afterAll(async () => {
  await seed?.close()
})

async function client(
  browser: Browser,
  indexRef = "",
  messaging?: {deviceSecret: string; peerId: string}
): Promise<{context: BrowserContext; page: Page}> {
  const context = await browser.newContext()
  await context.addInitScript(
    ({seedUrl, discoveryApp, indexRef, relayUrl, messaging}) => {
      if (messaging)
        localStorage.setItem("iris-client:fips-device-secret", messaging.deviceSecret)
      window.__IRIS_FIPS_TEST_CONFIG__ = {
        discoveryApp,
        relays: [relayUrl],
        seeds: [seedUrl],
        indexRef,
        peers: messaging ? [messaging.peerId] : [],
      }
      window.__HTREE_SERVER_URL__ = relayUrl.replace("ws:", "http:")
      localStorage.setItem(
        "ui-storage",
        JSON.stringify({state: {showRelayIndicator: true}, version: 0})
      )
    },
    {
      seedUrl: seed.url,
      discoveryApp: "iris-peer-test-" + new URL(seed.url).port + "-" + test.info().testId,
      indexRef,
      relayUrl,
      messaging,
    }
  )
  // A remote file service cannot accidentally satisfy the test.
  await context.route("https://**/*", (route) => route.abort())
  const page = await context.newPage()
  await signUp(page, "Peer file test")
  return {context, page}
}
async function peers(page: Page) {
  return page
    .evaluate(async () => {
      const {getPeerRuntime} = await import("/src/lib/peerRuntime.ts")
      return (await getPeerRuntime())?.provider.listPeerIds() ?? []
    })
    .catch(() => [])
}
async function download(page: Page, nhash: string) {
  return page.evaluate(async (nhash) => {
    const {downloadFile} = await import("/src/lib/hashtree.ts")
    return Array.from(await downloadFile(nhash))
  }, nhash)
}

test("cached encrypted attachment is served across real browser peers without file servers", async ({
  browser,
}) => {
  // Two added recovery phases retain the existing 30-second connection limit.
  test.setTimeout(210000)
  const first = await client(browser)
  const second = await client(browser)
  try {
    await expect
      .poll(async () => (await peers(first.page)).length, {timeout: 30000})
      .toBeGreaterThan(0)
    await expect
      .poll(async () => (await peers(second.page)).length, {timeout: 30000})
      .toBeGreaterThan(0)
    for (const instance of [first, second]) {
      await expect(
        instance.page.getByTestId("connectivity-indicator").first()
      ).toHaveAttribute("data-connection-state", "peers", {timeout: 30000})
    }
    const initialPeerIds = await Promise.all([first, second].map(({page}) =>
      page.evaluate(async () =>
        (await (await import("/src/lib/peerRuntime.ts")).getPeerRuntime())!.provider.localPeerId
      )
    ))
    expect(initialPeerIds[0]).not.toBe(initialPeerIds[1])
    const bytes = Array.from(randomBytes(32000))
    const nhash = await first.page.evaluate(async (bytes) => {
      const {uploadFile} = await import("/src/lib/hashtree.ts")
      return (await uploadFile(new File([new Uint8Array(bytes)], "peer-photo.bin"))).nhash
    }, bytes)
    expect(await download(second.page, nhash)).toEqual(bytes)
    // The visible network status must distinguish a real WebRTC link from the seed.
    await expect(
      second.page.getByTestId("connectivity-indicator").first()
    ).toHaveAttribute("data-connection-state", "peers", {timeout: 30000})
    await second.page.getByTestId("connectivity-indicator").first().click()
    const settings = second.page.getByTestId("peer-network-settings")
    await expect(
      settings.locator('[data-testid="network-peer"][data-transport="webrtc"]').first()
    ).toBeVisible()
    await expect(settings.getByText("WebRTC · Connected").first()).toBeVisible()
    const remote = await first.page.evaluate(
      async () =>
        (await (await import("/src/lib/peerRuntime.ts")).getPeerRuntime())!.provider
          .localPeerId
    )
    await expect(
      settings.getByTestId("nostr-endpoint").locator(`[title="${remote}"]`)
    ).toBeVisible()
    await expect
      .poll(async () =>
        second.page.evaluate(async () => {
          const {getPeerNetworkSnapshot} = await import("/src/lib/peerNetworkStats.ts")
          return getPeerNetworkSnapshot().transports.webrtc?.bytesReceived ?? 0
        })
      )
      .toBeGreaterThan(bytes.length)
    await expect(settings.getByTestId("peer-bandwidth-chart")).toBeVisible()
    await second.page.screenshot({
      path: test.info().outputPath("network-desktop.png"),
      fullPage: true,
    })
    await second.page.setViewportSize({width: 390, height: 844})
    await expect(settings).toBeVisible()
    expect(
      await second.page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true)
    await second.page.screenshot({
      path: test.info().outputPath("network-mobile.png"),
      fullPage: true,
    })
    await settings.getByTestId("peer-bandwidth-chart").scrollIntoViewIfNeeded()
    await second.page.screenshot({
      path: test.info().outputPath("network-mobile-traffic.png"),
      fullPage: true,
    })
    // Cached encrypted chunks survive app/worker restart.
    await second.page.reload()
    expect(await download(second.page, nhash)).toEqual(bytes)
    // Exercise each real browser after reload. The new block is created only
    // after recovery, is absent at the receiver, and bypasses HTTP/cache reads.
    for (const senderIndex of [1, 0]) {
      const instances = [first, second]
      const sender = instances[senderIndex], receiver = instances[1 - senderIndex]
      if (senderIndex === 0) await sender.page.reload()
      await Promise.all(instances.map(({page}, index) => expect.poll(() =>
        page.evaluate(async (otherPeerId) => {
          const runtime = await (await import("/src/lib/peerRuntime.ts")).getPeerRuntime()
          return {
            localPeerId: runtime?.provider.localPeerId ?? "",
            connected: runtime?.provider.listConnectedPeerIds().includes(otherPeerId) ?? false,
          }
        }, initialPeerIds[1 - index]), {timeout: 30000}
      ).toEqual({localPeerId: initialPeerIds[index], connected: true})))
      const block = await sender.page.evaluate(async () => {
        const {localBlocks} = await import("/src/lib/fileStore.ts")
        const data = crypto.getRandomValues(new Uint8Array(32000))
        const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data))
        await localBlocks.put(hash, data)
        if (!await localBlocks.has(hash)) throw new Error("Fresh source block was not stored")
        return {
          hashHex: Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join(""),
          bytes: data.length,
        }
      })
      const received = await receiver.page.evaluate(async ({block, sourcePeerId}) => {
        const {localBlocks} = await import("/src/lib/fileStore.ts")
        const runtime = await (await import("/src/lib/peerRuntime.ts")).getPeerRuntime()
        if (!runtime) throw new Error("Peer runtime unavailable after reload")
        const hash = Uint8Array.from(block.hashHex.match(/../g)!, byte => parseInt(byte, 16))
        const wasCached = await localBlocks.has(hash)
        const receivedBytes = () => runtime.provider.getNetworkStats().peers
          .filter(peer => peer.peerId === sourcePeerId && peer.transport === "webrtc")
          .reduce((total, peer) => total + peer.bytesReceived, 0)
        const before = receivedBytes()
        const data = await runtime.provider.fetch(block.hashHex, sourcePeerId, 0)
        return {
          wasCached,
          bytes: data?.length ?? 0,
          hashHex: data ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data))),
            byte => byte.toString(16).padStart(2, "0")).join("") : null,
          webrtcBytesReceived: receivedBytes() - before,
        }
      }, {block, sourcePeerId: initialPeerIds[senderIndex]})
      expect(received.wasCached).toBe(false)
      expect(received.bytes).toBe(block.bytes)
      expect(received.hashHex).toBe(block.hashHex)
      expect(received.webrtcBytesReceived).toBeGreaterThanOrEqual(block.bytes)
      console.log("PEER_RELOAD_RECOVERY", JSON.stringify({
        app: "iris-client", endpoint: senderIndex, reloaded: true,
        identityPreserved: true, peerRecovered: true, receiverCacheMiss: true,
        freshHash: block.hashHex, bytes: received.bytes,
        webrtcBytesReceived: received.webrtcBytesReceived,
      }))
    }
    await first.context.close()
    // A fresh browser must now obtain the downloaded copy from the second client.
    const third = await client(browser)
    try {
      await expect
        .poll(async () => (await peers(third.page)).length, {timeout: 30000})
        .toBeGreaterThan(0)
      expect(await download(third.page, nhash)).toEqual(bytes)
    } finally {
      await third.context.close()
    }
  } finally {
    await first.context.close()
    await second.context.close()
  }
})

test("seed-only connectivity stays amber and disconnects clear the visible peer list", async ({
  browser,
}) => {
  const instance = await client(browser)
  try {
    await instance.page.getByTestId("connectivity-indicator").first().click()
    const settings = instance.page.getByTestId("peer-network-settings")
    await expect(settings.locator('[data-transport="websocket"]').first()).toBeVisible({
      timeout: 30000,
    })
    await expect(settings.locator('[data-transport="webrtc"]')).toHaveCount(0)
    await expect(
      instance.page.getByTestId("connectivity-indicator").first()
    ).toHaveAttribute("data-connection-state", "servers")
    await expect(
      settings.getByRole("heading", {name: "Direct FIPS peers (1)", exact: true})
    ).toBeVisible()
    await expect(
      settings.getByRole("heading", {name: "Nostr endpoints (0)", exact: true})
    ).toBeVisible()
    await expect(settings.getByText("No peers connected yet.")).toHaveCount(0)
    await instance.page.evaluate(async () => {
      const {getPeerRuntime} = await import("/src/lib/peerRuntime.ts")
      await (await getPeerRuntime())?.close()
    })
    await expect(settings.getByTestId("network-peer")).toHaveCount(0)
    await expect(settings.getByText("Peer network unavailable.")).toBeVisible()
  } finally {
    await instance.context.close()
  }
})

test("a routed Nostr endpoint appears separately from its forwarding seed", async ({
  browser,
}) => {
  const identity = await generateIdentity()
  const deviceSecret = generateSecretKey()
  const device = await identityFromSecretKey(deviceSecret)
  const peerId = toHex(identity.publicKey)
  const node = new FipsNode({
    identity,
    transports: [new WebSocketTransport({seedUrls: [seed.url]})],
    routingMode: "reply_learned",
  })
  await node.start()
  const service = new FipsNostrPubsubClient({
    node,
    localPeerId: peerId,
    peers: () => [toHex(device.publicKey)],
  }).start()
  try {
    const instance = await client(browser, "", {
      deviceSecret: toHex(deviceSecret),
      peerId,
    })
    try {
      await instance.page.getByTestId("connectivity-indicator").first().click()
      const settings = instance.page.getByTestId("peer-network-settings")
      const endpoint = settings
        .getByTestId("nostr-endpoint")
        .filter({has: instance.page.locator(`[title="${peerId}"]`)})
      await expect(endpoint).toContainText("Routed", {timeout: 30000})
      await expect(
        settings.getByTestId("network-peer").locator(`[title="${peerId}"]`)
      ).toHaveCount(0)
      await instance.page.evaluate(async () => {
        const {getPeerRuntime} = await import("/src/lib/peerRuntime.ts")
        await (await getPeerRuntime())?.close()
      })
      await expect(settings.getByTestId("nostr-endpoint")).toHaveCount(0)
    } finally {
      await instance.context.close()
    }
  } finally {
    await service.stop()
    await node.stop()
  }
})

test("opens a note from a peer-served index fork and still receives relay events", async ({
  browser,
}) => {
  const blocks = new MemoryStore()
  let state: HashtreeRuntimeState = {root: null, outboxRoot: null, pending: []}
  const writer = new HashtreeRuntimeEventStore(blocks, {
    load: async () => state,
    save: async (next) => {
      state = next
    },
  })
  const signNote = (content: string) =>
    finalizeEvent(
      {
        kind: 1,
        content,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
      },
      generateSecretKey()
    )
  const upstream = signNote("A post in the upstream index")
  await writer.put(upstream)
  const forkNote = signNote("A post available only in this index fork")
  await writer.put(forkNote)
  const root = state.root!
  const announcement = finalizeEvent(
    {
      kind: 30064,
      content: "",
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["d", "nostr-event-index"],
        ["l", "hashtree"],
        ["hash", toHex(root.hash)],
        ...(root.key ? [["key", toHex(root.key)]] : []),
      ],
    },
    generateSecretKey()
  )
  const relay = await Relay.connect(relayUrl)
  await relay.publish(announcement)
  const first = await client(browser)
  const second = await client(
    browser,
    nip19.npubEncode(announcement.pubkey) + "/nostr-event-index"
  )
  try {
    const entries = await Promise.all(
      blocks
        .keys()
        .map(
          async (hash) => [toHex(hash), Array.from((await blocks.get(hash))!)] as const
        )
    )
    await first.page.evaluate(async (entries) => {
      const {localBlocks} = await import("/src/lib/fileStore.ts")
      for (const [hex, bytes] of entries) {
        const hash = Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16))
        await localBlocks.put(hash, Uint8Array.from(bytes))
      }
    }, entries)
    await expect
      .poll(async () => (await peers(second.page)).length, {timeout: 30000})
      .toBeGreaterThan(0)
    const openNote = async (id: string) => {
      const path = "/" + nip19.noteEncode(id)
      await second.page.evaluate((path) => {
        window.dispatchEvent(new CustomEvent("iris-deep-link", {detail: {path}}))
      }, path)
      await expect(second.page).toHaveURL(new RegExp(path + "$"))
    }
    for (const event of [forkNote, upstream]) {
      await openNote(event.id)
      await expect(
        second.page.getByText(event.content, {exact: true}).first()
      ).toBeVisible({timeout: 30000})
    }
    const live = signNote("A post available only from the relay")
    await relay.publish(live)
    await openNote(live.id)
    await expect(second.page.getByText(live.content, {exact: true}).first()).toBeVisible()
  } finally {
    relay.close()
    await first.context.close()
    await second.context.close()
  }
})
