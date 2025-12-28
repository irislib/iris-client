/**
 * Relay Worker
 *
 * Runs NDK with actual WebSocket relay connections in a worker thread.
 * Main thread communicates via NDKWorkerTransport.
 * Cache operations delegated to separate cache worker.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Can't use path aliases in worker, use relative imports
import {createDebugLogger} from "../utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "../utils/constants"
const {log, warn, error} = createDebugLogger(DEBUG_NAMESPACES.NDK_RELAY)

import NDK from "../lib/ndk"
import {
  initSearchIndex,
  searchProfiles,
  updateSearchIndex,
  type SearchResult,
} from "./profile-search"
import {NDKEvent} from "../lib/ndk/events"
import {NDKSubscriptionCacheUsage, type NDKFilter} from "../lib/ndk/subscription"
import {NDKRelay} from "../lib/ndk/relay"
import NDKCacheAdapterDexie, {db} from "../lib/ndk-cache"
import type {
  WorkerMessage,
  WorkerResponse,
  WorkerSubscribeOpts,
  WorkerPublishOpts,
} from "../lib/ndk-transport-types"
import type {SettingsState} from "../stores/settings"

// WASM sig verification - nostr-wasm Nostr interface
interface WasmVerifier {
  verifyEvent(event: unknown): void // throws on invalid sig
}
let wasmVerifier: WasmVerifier | null = null
let wasmLoading = false

async function loadWasm() {
  if (wasmVerifier || wasmLoading) return
  wasmLoading = true
  try {
    const {initNostrWasm} = await import("nostr-wasm")
    wasmVerifier = await initNostrWasm()
    log("[Relay Worker] WASM sig verifier loaded")
  } catch (err) {
    error("[Relay Worker] WASM load failed:", err)
  } finally {
    wasmLoading = false
  }
}

// Types imported from ndk-transport-types.ts

let ndk: NDK
let cache: NDKCacheAdapterDexie
const subscriptions = new Map<string, any>()
const connectedRelays = new Set<string>() // Track relays that were connected before offline
let settings: SettingsState | undefined

async function initSearchFromDexie() {
  try {
    const start = performance.now()
    const profiles = await db.profiles.toArray()
    const searchProfiles: SearchResult[] = []
    for (const p of profiles) {
      const name = p.name || p.username
      if (name) {
        searchProfiles.push({
          pubKey: p.pubkey,
          name: String(name),
          nip05: p.nip05 || undefined,
        })
      }
    }
    initSearchIndex(searchProfiles)
    const duration = performance.now() - start
    log(
      `[Relay Worker] Search index initialized: ${searchProfiles.length} profiles in ${duration.toFixed(0)}ms`
    )
    self.postMessage({type: "searchReady"} as WorkerResponse)
  } catch (err) {
    error("[Relay Worker] Failed to init search from Dexie:", err)
  }
}

function handleSearch(requestId: number, query: string) {
  const results = searchProfiles(query)
  self.postMessage({
    type: "searchResult",
    searchRequestId: requestId,
    searchResults: results,
  } as WorkerResponse)
}

// Attach status change listeners to a relay
function attachRelayListeners(relay: NDKRelay) {
  const handler = (eventType: string) => {
    log(`[Relay Worker] ${relay.url} ${eventType}, status: ${relay.status}`)
    broadcastRelayStatus()
  }
  relay.on("connect", () => {
    connectedRelays.add(relay.url)
    handler("connected")
  })
  relay.on("disconnect", () => handler("disconnected"))
  relay.on("flapping", () => handler("flapping"))
  relay.on("authed", () => handler("authed"))
}

// Default relays if none provided
const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
]

async function initialize(relayUrls?: string[], initialSettings?: SettingsState) {
  try {
    log("[Relay Worker] Starting initialization with relays:", relayUrls)

    // Store settings
    if (initialSettings) {
      settings = initialSettings
      log("[Relay Worker] Settings initialized:", settings)
    }

    // Initialize Dexie cache for writing only (main thread handles reads)
    log("[Relay Worker] Initializing cache adapter...")
    cache = new NDKCacheAdapterDexie({
      dbName: "treelike-nostr",
      saveSig: true,
      eventCacheSize: 5000,
    })
    log("[Relay Worker] Cache adapter ready (write-only, main thread queries)")

    // Initialize NDK with relay connections
    const relaysToUse = relayUrls && relayUrls.length > 0 ? relayUrls : DEFAULT_RELAYS
    log("[Relay Worker] Creating NDK with relays:", relaysToUse)

    ndk = new NDK({
      explicitRelayUrls: relaysToUse,
      cacheAdapter: cache, // For writing fresh events to cache
      enableOutboxModel: false,
      negentropyEnabled: settings?.network.negentropyEnabled ?? false,
    })

    // Setup custom sig verification with wasm fallback
    ndk.signatureVerificationFunction = async (event: NDKEvent) => {
      if (wasmVerifier) {
        try {
          wasmVerifier.verifyEvent({
            id: event.id,
            sig: event.sig!,
            pubkey: event.pubkey,
            content: event.content,
            kind: event.kind!,
            created_at: event.created_at!,
            tags: event.tags,
          })
          return true
        } catch {
          return false
        }
      }
      // Fallback to JS verification until wasm loads
      return !!event.verifySignature(false)
    }

    // Lazy load wasm in background
    loadWasm()

    // Initialize search index from Dexie in background
    initSearchFromDexie()

    // Forward relay notices to main thread
    ndk.pool?.on("notice", (relay: NDKRelay, notice: string) => {
      self.postMessage({
        type: "notice",
        relay: relay.url,
        notice,
      } as WorkerResponse)
    })

    // Connect to relays (non-blocking - don't wait for all relays)
    log("[Relay Worker] Starting relay connections...")
    ndk.connect().then(() => {
      log(`[Relay Worker] All relays connected`)
    })

    // Attach status listeners immediately
    ndk.pool?.relays.forEach((relay) => {
      attachRelayListeners(relay)
    })

    log(`[Relay Worker] Initialized with ${ndk.pool?.relays.size || 0} relays`)

    // Signal ready immediately - don't wait for relay connections
    self.postMessage({type: "ready"} as WorkerResponse)
  } catch (err) {
    error("[Relay Worker] Initialization failed:", err)
    self.postMessage({
      type: "error",
      error: err instanceof Error ? err.message : String(err),
    } as WorkerResponse)
  }
}

function handleSubscribe(
  subId: string,
  filters: NDKFilter[],
  opts?: WorkerSubscribeOpts
) {
  if (!ndk) {
    error("[Relay Worker] NDK not initialized")
    return
  }

  // Log subscription stats
  const activeSubCount = subscriptions.size
  if (activeSubCount > 10) {
    warn(
      `[Relay Worker] HIGH SUB COUNT: ${activeSubCount} active subscriptions. New sub: ${subId}, filters: ${JSON.stringify(filters).slice(0, 200)}`
    )
  }

  log(
    `[Relay Worker] handleSubscribe subId=${subId}, filters=${JSON.stringify(filters)}, opts=${JSON.stringify(opts)}`
  )

  // Clean up existing subscription with same ID
  if (subscriptions.has(subId)) {
    subscriptions.get(subId).stop()
  }

  const destinations = opts?.destinations || ["cache", "relay"]
  const cacheOnly = destinations.includes("cache") && !destinations.includes("relay")
  const relayOnly = destinations.includes("relay") && !destinations.includes("cache")

  let cacheUsage: NDKSubscriptionCacheUsage
  if (cacheOnly) {
    cacheUsage = NDKSubscriptionCacheUsage.ONLY_CACHE
  } else if (relayOnly) {
    cacheUsage = NDKSubscriptionCacheUsage.ONLY_RELAY
  } else {
    cacheUsage = NDKSubscriptionCacheUsage.PARALLEL
  }

  log(`[Relay Worker] Using cacheUsage: ${cacheUsage}`)

  // Enable groupable by default for relay subscriptions to batch requests
  // Cache-only subs don't need grouping (instant local response)
  const shouldGroup = cacheOnly ? false : (opts?.groupable ?? true)
  const groupableDelay = shouldGroup ? (opts?.groupableDelay ?? 100) : undefined

  const sub = ndk.subscribe(filters, {
    closeOnEose: opts?.closeOnEose ?? cacheOnly,
    groupable: shouldGroup,
    groupableDelay,
    cacheUsage,
  })

  sub.on("event", (event: NDKEvent) => {
    const rawEvent = event.rawEvent()
    self.postMessage({
      type: "event",
      subId,
      event: rawEvent,
    } as WorkerResponse)

    // Index profile events (kind 0) for search
    if (rawEvent.kind === 0) {
      try {
        const content = JSON.parse(rawEvent.content)
        updateSearchIndex(
          rawEvent.pubkey,
          content.name || content.username,
          content.nip05,
          rawEvent.created_at
        )
      } catch {
        // Invalid profile content, skip
      }
    }
  })

  sub.on("eose", () => {
    self.postMessage({
      type: "eose",
      subId,
    } as WorkerResponse)

    // Auto-cleanup cache-only subs after EOSE
    if (cacheOnly) {
      subscriptions.delete(subId)
    }
  })

  subscriptions.set(subId, sub)
}

function handleUnsubscribe(subId: string) {
  const sub = subscriptions.get(subId)
  if (sub) {
    sub.stop()
    subscriptions.delete(subId)
  }
}

async function handlePublish(
  id: string,
  eventData: any,
  relayUrls?: string[],
  opts?: WorkerPublishOpts
) {
  if (!ndk) {
    self.postMessage({
      type: "error",
      id,
      error: "NDK not initialized",
    } as WorkerResponse)
    return
  }

  try {
    const event = new NDKEvent(ndk, eventData)

    // Verify signature if requested (e.g., WebRTC events from untrusted sources)
    if (opts?.verifySignature) {
      const isValid = event.verifySignature(false)
      if (!isValid) {
        warn(
          "[Relay Worker] Invalid signature for event from:",
          opts.source,
          eventData.id
        )
        self.postMessage({
          type: "error",
          id,
          error: "Invalid signature",
        } as WorkerResponse)
        return
      }
    }

    const destinations = opts?.publishTo || ["relay"]

    // Dispatch to local subscriptions if requested
    if (destinations.includes("subscriptions")) {
      log(
        "[Relay Worker] Dispatching to subscriptions:",
        eventData.id,
        "source:",
        opts?.source
      )
      const fakeRelay = {url: opts?.source || "__local__"} as NDKRelay
      ndk.subManager.dispatchEvent(event, fakeRelay, false)
    }

    // Cache handled automatically by NDK cache adapter on dispatch

    // Publish to relays if requested
    if (!destinations.includes("relay")) {
      self.postMessage({
        type: "published",
        id,
      } as WorkerResponse)
      return
    }

    log("[Relay Worker] Publishing event:", eventData.id)

    // Publish to specified relays or all connected relays
    let relays: any = undefined
    if (relayUrls && relayUrls.length > 0) {
      relays = ndk.pool?.relays
        ? Array.from(ndk.pool.relays.values()).filter((r) => relayUrls.includes(r.url))
        : undefined
      log(
        "[Relay Worker] Publishing to specific relays:",
        relayUrls,
        "found:",
        relays?.length
      )
    } else {
      log("[Relay Worker] Publishing to all relays, pool size:", ndk.pool?.relays.size)
    }

    // Increase timeout to allow relays to connect (10s)
    await event.publish(relays, 10_000)

    log("[Relay Worker] Event published successfully:", eventData.id)
    self.postMessage({
      type: "published",
      id,
    } as WorkerResponse)
  } catch (err) {
    error("[Relay Worker] Publish failed:", err)
    self.postMessage({
      type: "error",
      id,
      error: err instanceof Error ? err.message : String(err),
    } as WorkerResponse)
  }
}

function getRelayStatuses() {
  if (!ndk?.pool) return []

  return Array.from(ndk.pool.relays.values()).map((relay) => ({
    url: relay.url,
    status: relay.status,
    stats: {
      attempts: relay.connectivity?.connectionStats.attempts || 0,
      success: relay.connectivity?.connectionStats.success || 0,
      connectedAt: (relay.connectivity as any)?.connectedAt,
    },
  }))
}

function handleGetRelayStatus(requestId: string) {
  self.postMessage({
    type: "relayStatus",
    id: requestId,
    relayStatuses: getRelayStatuses(),
  } as WorkerResponse)
}

function broadcastRelayStatus() {
  const statuses = getRelayStatuses()
  log(`[Relay Worker] Broadcasting status update: ${statuses.length} relays`)
  self.postMessage({
    type: "relayStatusUpdate",
    relayStatuses: statuses,
  } as WorkerResponse)
}

function handleAddRelay(url: string) {
  if (!ndk?.pool) return
  const relay = new NDKRelay(url, undefined, ndk)
  attachRelayListeners(relay)
  ndk.pool.addRelay(relay) // This will connect automatically
  broadcastRelayStatus()
}

function handleRemoveRelay(url: string) {
  if (!ndk?.pool) return
  const relay = ndk.pool.relays.get(url)
  if (relay) {
    relay.disconnect()
    ndk.pool.relays.delete(url)
  }
}

function handleConnectRelay(url: string) {
  if (!ndk?.pool) return
  const relay = ndk.pool.relays.get(url)
  relay?.connect()
}

function handleDisconnectRelay(url: string) {
  if (!ndk?.pool) return
  const relay = ndk.pool.relays.get(url)
  relay?.disconnect()
}

function handleReconnectDisconnected(reason: string) {
  if (!ndk?.pool) return

  log(`[Relay Worker] ${reason}, checking relay connections...`)

  // Force immediate reconnection only for relays that were connected before
  // NDKRelayStatus: DISCONNECTED=1, RECONNECTING=2, FLAPPING=3, CONNECTING=4, CONNECTED=5+
  for (const relay of ndk.pool.relays.values()) {
    if (relay.status < 5 && connectedRelays.has(relay.url)) {
      log(`[Relay Worker] Forcing reconnection to ${relay.url} (status: ${relay.status})`)
      relay.connect()
    }
  }
}

function handleBrowserOffline() {
  if (!ndk?.pool) return

  log("[Relay Worker] Browser offline event received, disconnecting all relays")

  // Immediately disconnect all connected relays
  for (const relay of ndk.pool.relays.values()) {
    if (relay.status >= 5) {
      // CONNECTED or higher
      log(`[Relay Worker] Disconnecting ${relay.url} due to browser offline`)
      relay.disconnect()
    }
  }
}

function handleBrowserOnline() {
  if (!ndk?.pool) return

  log("[Relay Worker] Browser online event received, reconnecting relays")
  handleReconnectDisconnected("Browser came online")
}

async function handleGetStats(id: string) {
  try {
    if (!db) {
      self.postMessage({
        type: "stats",
        id,
        stats: {
          totalEvents: 0,
          eventsByKind: {},
        },
      } as WorkerResponse)
      return
    }

    // Use count() - much faster than toArray()
    const totalEvents = await db.events.count()

    // Get all unique kinds using index, then count each
    const kinds = await db.events.orderBy("kind").uniqueKeys()
    const eventsByKind: Record<number, number> = {}

    // Count events per kind using indexed queries
    await Promise.all(
      kinds.map(async (kind) => {
        const kindNum = Number(kind)
        const count = await db.events.where("kind").equals(kindNum).count()
        eventsByKind[kindNum] = count
      })
    )

    self.postMessage({
      type: "stats",
      id,
      stats: {
        totalEvents,
        eventsByKind,
      },
    } as WorkerResponse)
  } catch (err) {
    error("[Relay Worker] Failed to get stats:", err)
    self.postMessage({
      type: "stats",
      id,
      stats: {
        totalEvents: 0,
        eventsByKind: {},
      },
    } as WorkerResponse)
  }
}

function handleClose() {
  // Stop all subscriptions
  subscriptions.forEach((sub) => sub.stop())
  subscriptions.clear()

  // Disconnect from relays
  if (ndk?.pool) {
    ndk.pool.relays.forEach((relay) => relay.disconnect())
  }
}

function handleUpdateSettings(newSettings: SettingsState) {
  log("[Relay Worker] Updating settings:", newSettings)
  settings = newSettings

  // Update NDK negentropy setting if initialized
  if (ndk) {
    ndk.negentropyEnabled = settings.network.negentropyEnabled
  }
}

// Listen for network status changes in worker
let wasOffline = false

self.addEventListener("online", () => {
  if (wasOffline) {
    log("[Relay Worker] Network connection restored")
    wasOffline = false
    handleReconnectDisconnected("Network connection restored")
  }
})

self.addEventListener("offline", () => {
  wasOffline = true
  log("[Relay Worker] Network connection lost")
})

// Message handler
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const data = e.data
  const {type, id, filters, event, relays, subscribeOpts, publishOpts} = data

  switch (type) {
    case "init":
      await initialize(relays, data.settings)
      break

    case "subscribe":
      if (id && filters) {
        handleSubscribe(id, filters as NDKFilter[], subscribeOpts)
      }
      break

    case "unsubscribe":
      if (id) {
        handleUnsubscribe(id)
      }
      break

    case "publish":
      if (id && event) {
        await handlePublish(id, event, relays, publishOpts)
      }
      break

    case "getRelayStatus":
      if (id) {
        handleGetRelayStatus(id)
      }
      break

    case "addRelay":
      if (data.url) {
        handleAddRelay(data.url)
      }
      break

    case "removeRelay":
      if (data.url) {
        handleRemoveRelay(data.url)
      }
      break

    case "connectRelay":
      if (data.url) {
        handleConnectRelay(data.url)
      }
      break

    case "disconnectRelay":
      if (data.url) {
        handleDisconnectRelay(data.url)
      }
      break

    case "reconnectDisconnected":
      handleReconnectDisconnected(data.reason || "Reconnect requested")
      break

    case "browserOffline":
      handleBrowserOffline()
      break

    case "browserOnline":
      handleBrowserOnline()
      break

    case "getStats":
      if (id) {
        handleGetStats(id)
      }
      break

    case "close":
      handleClose()
      break

    case "updateSettings":
      if (data.settings) {
        handleUpdateSettings(data.settings)
      }
      break

    case "search":
      if (data.searchQuery !== undefined && data.searchRequestId !== undefined) {
        handleSearch(data.searchRequestId, data.searchQuery)
      }
      break

    default:
      warn("[Relay Worker] Unknown message type:", type)
  }
}

// Handle errors
self.onerror = (err) => {
  error("[Relay Worker] Error:", err)
  self.postMessage({
    type: "error",
    error: err instanceof Error ? err.message : String(err),
  } as WorkerResponse)
}
