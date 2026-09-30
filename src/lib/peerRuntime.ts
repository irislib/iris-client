import {fromHex, toHex} from "@hashtree/core"
import {generateSecretKey} from "nostr-tools"
import {type NostrEventReader, type RuntimeSource} from "nostr-pubsub"
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

/** One authenticated FIPS node carries both file blocks and Nostr events. */
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
  const {createBrowserHashtreeNostrProvider, supportsBrowserHashtreeFips} =
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
  const configured = csv(import.meta.env.VITE_FIPS_PEERS)
  const seeds = overrides?.seeds ?? csv(import.meta.env.VITE_FIPS_WEBSOCKET_SEEDS)
  const provider = await createBrowserHashtreeNostrProvider({
    deviceSecretKey: deviceKey(),
    relays,
    localStore: localBlocks,
    discoveryApp: "iris-client",
    providerRoutes: configured.map((peerId) => ({peerId, htl: 0})),
    ...(seeds.length ? {websocketSeedUrls: seeds} : {}),
    maxConnections: 4,
    iceGatherTimeoutMs: 2000,
    requestTimeoutMs: 2500,
    limits: {maxFiltersPerSubscription: 32, maxActiveSubscriptions: 1024},
    retainedEventReader: {
      query: (filters, options) =>
        retainedEventReader?.query(filters, options) ??
        Promise.resolve({events: [], complete: false}),
    },
  })
  const stopObserving = observePeerNetwork(provider)
  return {
    provider,
    source: provider.nostrSource,
    close: async () => {
      stopObserving()
      await provider.stop()
      pending = undefined
    },
  }
}

declare global {
  interface Window {
    __IRIS_FIPS_TEST_CONFIG__?: {relays: string[]; seeds: string[]}
  }
}
