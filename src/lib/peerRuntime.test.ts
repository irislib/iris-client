import {afterEach, expect, it, vi} from "vitest"
import {finalizeEvent, generateSecretKey, getPublicKey} from "nostr-tools/pure"
import {
  FipsNostrPubsubClient,
  localIndexSource,
  type FipsPubsubWireMessage,
} from "nostr-pubsub"

const harness = vi.hoisted(() => ({
  options: [] as Record<string, any>[],
  endpoints: [] as {id: string; stopped: boolean}[],
  makeNode: undefined as unknown as (id: string) => any,
}))
const providerId = `02${"11".repeat(32)}`
vi.mock("@hashtree/fips-transport/browser", () => ({
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
      publicKey: getPublicKey(new Uint8Array(32).fill(1)),
      relayConfigs: [{url: "ws://fixture.invalid"}],
    }),
  },
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
  vi.unstubAllEnvs()
})

it("keeps real FIPS private copies and profile scopes off the live device endpoint", async () => {
  vi.stubEnv("VITE_E2E", "")
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
    const discovery = await runtime!.source.subscribe!(
      [{kinds: [0, 37368], authors: ["aa".repeat(32), "bb".repeat(32)]}],
      () => {}
    )
    await vi.waitFor(() =>
      expect(frames.filter((frame) => frame.type === "req")).toHaveLength(3)
    )
    expect(harness.endpoints).toHaveLength(6) // device + three copies + two subjects
    expect(new Set(harness.endpoints.map((endpoint) => endpoint.id)).size).toBe(6)
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
    expect(requests).toContainEqual([{kinds: [1059], "#p": ["dd".repeat(32)]}])
    for (const filters of requests.filter((filters) => filters[0].authors)) {
      expect(filters[0].authors).toHaveLength(1)
    }
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

it("does not export privately looked-up profiles or adverts from the shared retained reader", async () => {
  vi.stubEnv("VITE_E2E", "")
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
  const ownProfile = event(0, new Uint8Array(32).fill(1))
  const privateResults = [0, 37195, 54321].map((kind) => event(kind, privateContact))
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
  const {getPeerRuntime, setRetainedEventReader} = await import("./peerRuntime")
  setRetainedEventReader({
    query: async () => ({
      complete: true,
      events: [ownProfile, ...privateResults].map((event) => ({
        event,
        source: localIndexSource("shared-cache"),
        priority: 300,
      })),
    }),
  })
  const runtime = await getPeerRuntime()
  try {
    const broad = provider.subscribe([{kinds: [0, 37195, 54321]}], () => {})
    await vi.waitFor(() =>
      expect(
        frames.some((frame) => frame.type === "event" && frame.event.id === ownProfile.id)
      ).toBe(true)
    )
    // Allow queued TCP records to flush; both full EVENT and inventory are checked.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const wire = JSON.stringify(frames)
    for (const event of privateResults) {
      expect(wire).not.toContain(event.id)
      expect(wire).not.toContain(event.pubkey)
    }
    broad.close()
  } finally {
    await runtime?.close()
    await provider.stop()
    setRetainedEventReader({query: async () => ({events: [], complete: true})})
  }
})

it("keeps inbox reception working with no anonymous message provider configured", async () => {
  vi.stubEnv("VITE_E2E", "")
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
      expect(frames.filter((frame) => frame.type === "req")).toHaveLength(1)
    )
    expect(frames.find((frame) => frame.type === "req")).toMatchObject({filters: [inbox]})
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
