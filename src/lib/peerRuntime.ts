import {fromHex, toHex, MemoryStore} from "@hashtree/core"
import {generateSecretKey} from "nostr-tools"
import {
  createAnonymousFipsDiscovery,
  createAnonymousFipsPublisher,
  createScopedFipsSource,
  FipsNostrPubsubClient,
  FipsNostrPubsubEventSource,
  isPrivateRelayEvent,
  type NostrEventReader,
  type RuntimeSource,
} from "nostr-pubsub"
import type {BrowserHashtreeFipsProvider} from "@hashtree/fips-transport/browser"
import {useUserStore} from "@/stores/user"
import {getInjectedHtreeRelayUrl} from "@/utils/nativeHtree"

import {localBlocks} from "./fileStore"
import {observePeerNetwork, setPeerNetworkStatus} from "./peerNetworkStats"
const DEVICE_KEY = "iris-client:fips-device-secret"
let retainedEventReader: NostrEventReader | undefined
export function setRetainedEventReader(reader: NostrEventReader) {
  retainedEventReader = reader
}
let pending: Promise<PeerRuntime | null> | undefined
export interface PeerRuntime {
  provider: BrowserHashtreeFipsProvider
  source: RuntimeSource
  close(): Promise<void>
}
const csv = (value: unknown) =>
  typeof value === "string"
    ? value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    : []
function deviceKey() {
  const saved = localStorage.getItem(DEVICE_KEY)
  if (saved && /^[0-9a-f]{64}$/.test(saved)) return fromHex(saved)
  const key = generateSecretKey()
  localStorage.setItem(DEVICE_KEY, toHex(key))
  return key
}

/** Live reception and files share a device endpoint; private sends use fresh endpoints. */
export function getPeerRuntime(): Promise<PeerRuntime | null> {
  return (pending ??= start().catch((error) => {
    pending = undefined
    setPeerNetworkStatus("unavailable")
    console.warn(
      "Peer network unavailable",
      error instanceof Error ? error.message : String(error)
    )
    return null
  }))
}
async function start(): Promise<PeerRuntime | null> {
  const {createBrowserHashtreeFipsProvider, supportsBrowserHashtreeFips} =
    await import("@hashtree/fips-transport/browser")
  if (!supportsBrowserHashtreeFips()) {
    setPeerNetworkStatus("unsupported")
    return null
  }
  setPeerNetworkStatus("starting")
  const user = useUserStore.getState()
  const overrides = import.meta.env.VITE_E2E
    ? window.__IRIS_FIPS_TEST_CONFIG__
    : undefined
  const relays = overrides?.relays ?? csv(import.meta.env.VITE_FIPS_RELAYS)
  if (!relays.length)
    relays.push(
      ...(getInjectedHtreeRelayUrl()
        ? [getInjectedHtreeRelayUrl()!]
        : user.relayConfigs.filter((r) => !r.disabled).map((r) => r.url))
    )
  const configured = csv(import.meta.env.VITE_FIPS_PEERS).map((peer) =>
    peer.toLowerCase()
  )
  if (configured.some((peer) => !/^(02|03)[0-9a-f]{64}$/.test(peer)))
    throw new Error("Invalid message provider")
  const seeds = overrides?.seeds ?? csv(import.meta.env.VITE_FIPS_WEBSOCKET_SEEDS)
  const base = {
    relays,
    discoveryApp: "iris-client",
    providerRoutes: configured.map((peerId) => ({peerId, htl: 0})),
    ...(seeds.length ? {websocketSeedUrls: seeds} : {}),
    maxConnections: 4,
    iceGatherTimeoutMs: 2000,
    requestTimeoutMs: 2500,
  }
  const {getSocialGraph} = await import("@/utils/socialGraph")
  const provider = await createBrowserHashtreeFipsProvider({
    ...base,
    deviceSecretKey: deviceKey(),
    localStore: localBlocks,
  })
  const lifetime = new AbortController()
  const createEndpoint = async () => {
    lifetime.signal.throwIfAborted()
    if (!configured.length) throw new Error("No private message provider is configured")
    const endpoint = await createBrowserHashtreeFipsProvider({
      ...base,
      deviceSecretKey: generateSecretKey(),
      localStore: new MemoryStore(),
      serveBlob: async () => null,
      forwarding: false,
      allowIncomingPeer: (peer) => configured.includes(peer.toLowerCase()),
    })
    if (lifetime.signal.aborted) {
      await endpoint.stop()
      lifetime.signal.throwIfAborted()
    }
    return {
      node: endpoint.node,
      localPeerId: endpoint.localPeerId,
      peers: () => configured,
      close: () => endpoint.stop(),
    }
  }
  const receiver = new FipsNostrPubsubClient({
    node: provider.node,
    localPeerId: provider.localPeerId,
    peers: () => [...new Set([...configured, ...provider.listConnectedPeerIds()])],
    role: "receiver",
    // This graph contains public kind-3 follows, never private contacts or groups.
    receiverPublicAuthors: () => {
      const owner = useUserStore.getState().publicKey
      return owner ? [owner, ...getSocialGraph().getFollowedByUser(owner)] : []
    },
    limits: {maxFiltersPerSubscription: 32, maxActiveSubscriptions: 1024},
    retainedEventReader: {
      query: async (filters, options) => {
        const report = await retainedEventReader?.query(filters, options)
        return report
          ? {
              ...report,
              events: report.events.filter(
                ({event}) =>
                  !isPrivateRelayEvent(event) &&
                  !(
                    event.kind === 37368 &&
                    event.tags.some(
                      (tag) => tag[0] === "type" && tag[1] === "group_roster"
                    )
                  )
              ),
            }
          : {events: [], complete: false}
      },
    },
  }).start()
  const anonymousPublisher = createAnonymousFipsPublisher({
    createEndpoint,
    timeoutMs: 2500,
  })
  const source = createScopedFipsSource({
    receiver: new FipsNostrPubsubEventSource(receiver),
    publisher: {
      publish: (event, origin) =>
        anonymousPublisher.publish(event, origin, {signal: lifetime.signal}),
    },
    discovery: configured.length
      ? createAnonymousFipsDiscovery({createEndpoint, timeoutMs: 2500})
      : {
          query: async () => ({events: [], complete: false}),
          subscribe: async () => ({close() {}}),
        },
  })
  const stopObserving = observePeerNetwork(provider)
  return {
    provider,
    source,
    close: async () => {
      lifetime.abort()
      source.close()
      stopObserving()
      try {
        await receiver.stop()
      } finally {
        pending = undefined
        await provider.stop()
      }
    },
  }
}

declare global {
  interface Window {
    __IRIS_FIPS_TEST_CONFIG__?: {relays: string[]; seeds: string[]}
  }
}
