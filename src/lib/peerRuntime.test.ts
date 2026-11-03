import "fake-indexeddb/auto"
import {afterEach, expect, it, vi} from "vitest"
import {finalizeEvent, generateSecretKey, getPublicKey} from "nostr-tools/pure"
import {
  FipsNostrPubsubClient,
  localIndexSource,
  type FipsPubsubWireMessage,
} from "nostr-pubsub"

const harness = vi.hoisted(() => ({
  options: [] as Record<string, any>[],
  retainedReaders: [] as unknown[],
  endpoints: [] as {id: string; stopped: boolean}[],
  me: {publicKey: "", privateKey: "", nip07Login: false},
  contacts: undefined as undefined | ((event: any) => void),
  updateAccount: undefined as undefined | (() => void),
  makeNode: undefined as unknown as (id: string) => any,
}))
const providerId = `02${"11".repeat(32)}`
vi.mock("@hashtree/fips-transport/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hashtree/fips-transport/browser")>()),
  openBrowserAnnouncements: async (
    ...args: Parameters<
      typeof import("@hashtree/fips-transport/browser").openBrowserAnnouncements
    >
  ) => {
    const actual =
      await importOriginal<typeof import("@hashtree/fips-transport/browser")>()
    harness.retainedReaders.push(args[3])
    return actual.openBrowserAnnouncements(...args)
  },
  supportsBrowserHashtreeFips: () => true,
  createBrowserHashtreeFipsProvider: async (options: Record<string, any>) => {
    harness.options.push(options)
    const id = `02${getPublicKey(options.deviceSecretKey)}`
    const state = {id, stopped: false}
    harness.endpoints.push(state)
    return {
      node: harness.makeNode(id),
      localPeerId: id,
      listConnectedPeerIds: () => [providerId],
      stop: async () => {
        state.stopped = true
      },
    }
  },
}))
vi.mock("./fileStore", () => ({localBlocks: {privateDeviceFiles: true}}))
vi.mock("./peerNetworkStats", () => ({
  observePeerNetwork: () => () => {},
  setPeerNetworkStatus() {},
}))
vi.mock("@/stores/user", () => ({
  useUserStore: {
    getState: () => ({
      ...harness.me,
      publicKey: harness.me.publicKey || getPublicKey(new Uint8Array(32).fill(1)),
      relayConfigs: [{url: "ws://fixture.invalid"}],
    }),
    subscribe: (fn: () => void) => {
      harness.updateAccount = fn
      return () => {
        harness.updateAccount = undefined
      }
    },
  },
}))
vi.mock("@/utils/nostrClient", () => ({
  nostr: () => ({
    subscribe: () => ({
      on: (_: string, callback: (event: any) => void) => {
        harness.contacts = callback
      },
      stop: () => {
        harness.contacts = undefined
      },
    }),
  }),
}))
vi.mock("@/utils/nativeHtree", () => ({getInjectedHtreeRelayUrl: () => null}))
vi.mock("@/utils/socialGraph", () => ({
  getSocialGraph: () => ({getFollowedByUser: () => []}),
}))

// The actual SDK TCP record protocol runs between these datagram endpoints.
// Only the browser's WebRTC/seed adapter is replaced.
class Network {
  nodes = new Map<string, any>()
  node(id: string) {
    const services = new Map<number, (context: any) => unknown>()
    const node = {
      registerService: (port: number, handler: (context: any) => unknown) => {
        services.set(port, handler)
        return () => services.delete(port)
      },
      on: () => () => {},
      sendDatagram: async (args: any) => {
        const target = this.nodes.get(args.dst)
        if (!target) throw new Error("unroutable fixture peer")
        queueMicrotask(() => {
          void target.receive({
            src: id,
            srcPort: args.srcPort ?? 0,
            dstPort: args.dstPort,
            payload: args.payload.slice(),
          })
        })
      },
      receive: async (context: any) => {
        await services.get(context.dstPort)?.(context)
      },
    }
    this.nodes.set(id, node)
    return node
  }
}
afterEach(() => {
  harness.me = {publicKey: "", privateKey: "", nip07Login: false}
  harness.retainedReaders.length = 0
  vi.unstubAllEnvs()
})

it("sends inbox interests and anonymous private copies but no browsing filters to Nostr endpoints", async () => {
  vi.stubEnv("VITE_E2E", "")
  vi.stubEnv("VITE_NOSTR_EVENT_INDEX", "")
  vi.stubEnv("VITE_FIPS_PEERS", providerId)
  harness.options.length = 0
  harness.endpoints.length = 0
  const network = new Network()
  harness.makeNode = (id) => network.node(id)
  const provider = new FipsNostrPubsubClient({
    node: network.node(providerId),
    localPeerId: providerId,
    peers: () => harness.endpoints.map((endpoint) => endpoint.id),
    acceptAnonymousPublications: true,
  }).start()
  const frames: FipsPubsubWireMessage[] = []
  const decode = provider.codec.decodeFrame.bind(provider.codec)
  vi.spyOn(provider.codec, "decodeFrame").mockImplementation((frame) => {
    const message = decode(frame)
    frames.push(message)
    return message
  })
  const {getPeerRuntime} = await import("./peerRuntime")
  const runtime = await getPeerRuntime()
  expect(runtime).not.toBeNull()
  const envelope = (recipient: string) =>
    finalizeEvent(
      {
        kind: 1060,
        tags: [
          ["p", recipient],
          ["v", "2"],
        ],
        content: "opaque session ciphertext",
        created_at: 1700000000,
      },
      generateSecretKey()
    )
  try {
    const peer = envelope("bb".repeat(32))
    for (const event of [envelope("cc".repeat(32)), peer, peer]) {
      expect(
        await runtime!.source.publish!(event, localIndexSource("fixture"))
      ).toMatchObject({
        accepted: true,
        remoteAccepted: true,
      })
    }
    const inbox = await runtime!.source.subscribe!(
      [{kinds: [1059], "#p": ["dd".repeat(32)]}],
      () => {}
    )
    const browsing = [
      {kinds: [0, 37368], authors: ["aa".repeat(32), "bb".repeat(32)]},
      {kinds: [7], "#e": ["ab".repeat(32)]},
      {ids: ["cd".repeat(32)]},
      {kinds: [1], search: "query text"},
      {kinds: [1059], "#p": ["dd".repeat(32)], "#e": ["ab".repeat(32)]},
    ]
    const discovery = await runtime!.source.subscribe!(browsing, () => {})
    await runtime!.source.query!(browsing)
    await vi.waitFor(() =>
      expect(frames.filter((frame) => frame.type === "req")).toHaveLength(2)
    )
    expect(harness.endpoints).toHaveLength(4) // device + three private copies
    expect(new Set(harness.endpoints.map((endpoint) => endpoint.id)).size).toBe(4)
    expect(harness.endpoints.slice(1, 4).every((endpoint) => endpoint.stopped)).toBe(true)
    for (const options of harness.options.slice(1)) {
      expect(options.localStore).not.toBe(harness.options[0].localStore)
      expect(options.forwarding).toBe(false)
      expect(await options.serveBlob()).toBeNull()
      expect(options.allowIncomingPeer(providerId)).toBe(true)
      expect(options.allowIncomingPeer(`02${"bb".repeat(32)}`)).toBe(false)
    }
    const requests = frames
      .filter((frame) => frame.type === "req")
      .map((frame) => frame.filters)
    expect(requests).toEqual(
      expect.arrayContaining([
        [{kinds: [1, 6, 16, 20, 1111, 30023]}],
        [{kinds: [1059], "#p": ["dd".repeat(32)]}],
      ])
    )
    expect(frames.filter((frame) => frame.type === "event")).toHaveLength(3)
    expect(frames.some((frame) => frame.type === "inv" || frame.type === "want")).toBe(
      false
    )
    discovery.close()
    inbox.close()
  } finally {
    await runtime?.close()
    await provider.stop()
  }
  expect(harness.endpoints.every((endpoint) => endpoint.stopped)).toBe(true)
})

it("isolates profile and post reads from peer replay while offering signed account feeds", async () => {
  vi.stubEnv("VITE_E2E", "")
  vi.stubEnv("VITE_NOSTR_EVENT_INDEX", "")
  vi.stubEnv("VITE_FIPS_PEERS", providerId)
  harness.options.length = 0
  harness.endpoints.length = 0
  const network = new Network()
  harness.makeNode = (id) => network.node(id)
  const privateContact = generateSecretKey()
  const event = (kind: number, secret: Uint8Array) =>
    finalizeEvent(
      {kind, created_at: 1700000000, tags: [], content: "cached public body"},
      secret
    )
  const owner = new Uint8Array(32).fill(1)
  const followed = getPublicKey(privateContact)
  harness.me = {
    publicKey: getPublicKey(owner),
    privateKey: "01".repeat(32),
    nip07Login: false,
  }
  const publicList = finalizeEvent(
    {kind: 3, created_at: 1700000000, tags: [["p", followed]], content: ""},
    owner
  )
  const publicPost = event(1, owner)
  const browsed = [0, 1].map((kind) => event(kind, privateContact))
  const provider = new FipsNostrPubsubClient({
    node: network.node(providerId),
    localPeerId: providerId,
    peers: () => harness.endpoints.map((endpoint) => endpoint.id),
  }).start()
  // Outgoing subscriptions validate locally through the same decoder as inbound wire frames.
  const broad = provider.subscribe([{kinds: [0, 1]}], () => {})
  const frames: FipsPubsubWireMessage[] = []
  const decode = provider.codec.decodeFrame.bind(provider.codec)
  vi.spyOn(provider.codec, "decodeFrame").mockImplementation((bytes) => {
    const message = decode(bytes)
    frames.push(message)
    return message
  })
  const {getPeerRuntime} = await import("./peerRuntime")
  const runtime = await getPeerRuntime()
  try {
    expect(harness.retainedReaders).toEqual([undefined])
    harness.contacts!({rawEvent: () => publicList})
    await vi.waitFor(() =>
      expect(
        frames
          .filter((frame) => frame.type === "req")
          .some((frame) =>
            frame.filters.some((filter) => filter.authors?.includes(followed))
          )
      ).toBe(true)
    )
    // A local profile/post read (including a followed author) must not provide
    // replay inventory. Explicit publication still reaches the waiting peer.
    await runtime!.source.query!([
      {kinds: [0], authors: [followed]},
      {ids: [browsed[1].id]},
    ])
    await vi.waitFor(() =>
      expect(provider.peerSubscriptionCount(harness.endpoints[0].id)).toBeGreaterThan(0)
    )
    await vi.waitFor(async () => {
      await runtime!.source.publish!(publicPost, localIndexSource("outbox"))
      expect(
        frames.some((frame) => frame.type === "event" && frame.event.id === publicPost.id)
      ).toBe(true)
    })
    const wire = JSON.stringify(frames)
    for (const item of browsed) expect(wire).not.toContain(item.id)
    const requests = frames.flatMap((frame) =>
      frame.type === "req" ? frame.filters : []
    )
    expect(requests).toContainEqual({
      kinds: [1, 6, 7, 9735],
      "#p": [harness.me.publicKey],
    })
    expect(requests.every((filter) => !filter.ids && !filter.kinds?.includes(0))).toBe(
      true
    )
    broad.close()
  } finally {
    await runtime?.close()
    await provider.stop()
  }
})

it("keeps inbox reception working with no anonymous message provider configured", async () => {
  vi.stubEnv("VITE_E2E", "")
  vi.stubEnv("VITE_NOSTR_EVENT_INDEX", "")
  vi.stubEnv("VITE_FIPS_PEERS", "")
  harness.options.length = 0
  harness.endpoints.length = 0
  const network = new Network()
  harness.makeNode = (id) => network.node(id)
  const provider = new FipsNostrPubsubClient({
    node: network.node(providerId),
    localPeerId: providerId,
    peers: () => harness.endpoints.map((endpoint) => endpoint.id),
  }).start()
  const frames: FipsPubsubWireMessage[] = []
  const decode = provider.codec.decodeFrame.bind(provider.codec)
  vi.spyOn(provider.codec, "decodeFrame").mockImplementation((bytes) => {
    const message = decode(bytes)
    frames.push(message)
    return message
  })
  const {getPeerRuntime} = await import("./peerRuntime")
  const runtime = await getPeerRuntime()
  try {
    const inbox = {kinds: [1059], "#p": ["dd".repeat(32)]}
    const subscription = await runtime!.source.subscribe!(
      [inbox, {kinds: [0], authors: ["bb".repeat(32)]}],
      () => {}
    )
    await vi.waitFor(() =>
      expect(frames.filter((frame) => frame.type === "req")).toHaveLength(2)
    )
    expect(frames).toContainEqual(
      expect.objectContaining({type: "req", filters: [inbox]})
    )
    const event = finalizeEvent(
      {
        kind: 1060,
        created_at: 1700000000,
        tags: [
          ["p", "bb".repeat(32)],
          ["v", "2"],
        ],
        content: "opaque",
      },
      generateSecretKey()
    )
    await expect(
      runtime!.source.publish!(event, localIndexSource("fixture"))
    ).rejects.toThrow("No private message provider")
    expect(harness.endpoints).toHaveLength(1)
    expect(frames.some((frame) => frame.type === "event" || frame.type === "inv")).toBe(
      false
    )
    subscription.close()
  } finally {
    await runtime?.close()
    await provider.stop()
  }
})
