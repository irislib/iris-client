import {
  verifyNostrEvent,
  localIndexSource,
  SOURCE_PRIORITY_LOCAL_INDEX,
} from "nostr-pubsub"
import type {Event, EventTemplate} from "nostr-tools"
import {serveNostrSource, connectNostrSource} from "@hashtree/worker/nostr-source-port"
/**
 * Relay Worker
 *
 * Runs NostrClient with actual WebSocket relay connections in a worker thread.
 * Main thread communicates via WorkerTransport.
 * Owns the persistent event store and sends verified events to the main thread.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Can't use path aliases in worker, use relative imports
import {createDebugLogger} from "../utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "../utils/constants"
const {log, warn, error} = createDebugLogger(DEBUG_NAMESPACES.NDK_RELAY)

// Global unhandled rejection handler to prevent worker crashes
self.onunhandledrejection = (event: PromiseRejectionEvent) => {
  error("[Relay Worker] Unhandled rejection:", event.reason)
  self.postMessage({
    type: "error",
    error: event.reason instanceof Error ? event.reason.message : String(event.reason),
  })
  // Prevent crash - just log
  event.preventDefault()
}

import NostrClient, {
  nip19,
  AppEvent,
  CacheMode,
  Relay,
  type EventFilter,
} from "@/lib/nostr"
import {
  getRemoteProfileSearchDebounceMs,
  initSearchIndex,
  mergeSearchProfiles,
  searchLocalProfiles,
  searchRemoteProfiles,
  searchProfilesWithProgress,
  setRemoteProfileSearchTreeResolver,
  shouldSkipRemoteProfileSearch,
  updateSearchIndex,
} from "./profile-search"
import {buildProfileSearchResult, type SearchResult} from "../utils/profileSearchData"
import {buildWorkerRelayUrls} from "../utils/relayRuntime"
import EventCache, {db} from "@/lib/nostr/cache"
import {fromHex, type CID} from "@hashtree/core"
import type {
  WorkerMessage,
  WorkerResponse,
  WorkerSubscribeOpts,
  WorkerPublishOpts,
} from "../lib/nostr-transport-types"
import type {SettingsState} from "../stores/settings"
import {DEFAULT_WORKER_RELAYS, SEARCH_RELAYS} from "../shared/constants/relays"
import {verifyRelayEvent, type WasmEventVerifier} from "./relay-signature-verifier"

// WASM sig verification - nostr-wasm Nostr interface
let wasmVerifier: WasmEventVerifier | null = null
let wasmLoading = false
let allowSearchRelays = false

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

// Types imported from nostr-transport-types.ts

let nostr: NostrClient
let cache: EventCache
const subscriptions = new Map<string, any>()
const connectedRelays = new Set<string>() // Track relays that were connected before offline
let settings: SettingsState | undefined
let latestSearchToken = 0

async function initSearchFromDexie() {
  try {
    const start = performance.now()
    const profiles = await db.profiles.toArray()
    const searchProfiles: SearchResult[] = []
    for (const p of profiles) {
      const searchProfile = buildProfileSearchResult(
        p.pubkey,
        p as unknown as Record<string, unknown>,
        p.created_at
      )
      if (searchProfile) {
        searchProfiles.push(searchProfile)
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

async function handleSearch(requestId: number, query: string) {
  const searchToken = ++latestSearchToken
  const emittedSignatures = new Set<string>()
  const emitSearchResults = (
    results: Awaited<ReturnType<typeof searchProfilesWithProgress>>,
    searchComplete: boolean
  ) => {
    const signature = JSON.stringify(
      results.map((result) => [
        result.item.pubKey,
        result.score ?? null,
        result.item.name,
        result.item.nip05 ?? null,
        result.item.picture ?? null,
        result.item.created_at ?? null,
        result.item.aliases ?? [],
      ])
    )
    if (!searchComplete && emittedSignatures.has(signature)) {
      return
    }
    emittedSignatures.add(signature)
    self.postMessage({
      type: "searchResult",
      searchRequestId: requestId,
      searchResults: results,
      searchComplete,
    } as WorkerResponse)
  }

  const trimmed = query.trim()
  const localResults = trimmed ? searchLocalProfiles(trimmed) : []
  emitSearchResults(localResults, shouldSkipRemoteProfileSearch(trimmed))

  if (!trimmed || shouldSkipRemoteProfileSearch(trimmed)) {
    return
  }

  const debounceMs = getRemoteProfileSearchDebounceMs(trimmed)
  if (debounceMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, debounceMs))
  }

  if (searchToken !== latestSearchToken) {
    emitSearchResults(localResults, true)
    return
  }

  const remoteResults = await searchRemoteProfiles(trimmed, (partialRemoteResults) => {
    if (searchToken !== latestSearchToken) {
      return
    }
    emitSearchResults(mergeSearchProfiles(localResults, partialRemoteResults), false)
  })

  if (searchToken !== latestSearchToken) {
    emitSearchResults(localResults, true)
    return
  }

  emitSearchResults(mergeSearchProfiles(localResults, remoteResults), true)
}

// Attach status change listeners to a relay
function attachRelayListeners(relay: Relay) {
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

function parseExtraRelayUrls(raw?: string): string[] {
  if (!raw) {
    return []
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

type TreeRootEventSnapshot = {
  root: CID
  eventId: string
  createdAt: number
}

function parseTreeRootEvent(rawEvent: {
  id?: string
  kind?: number
  created_at?: number
  tags?: string[][]
}): TreeRootEventSnapshot | null {
  if (rawEvent.kind !== 30078 || !Array.isArray(rawEvent.tags)) {
    return null
  }

  const hasHashtreeLabel = rawEvent.tags.some(
    (tag) => tag[0] === "l" && tag[1] === "hashtree"
  )
  const hasAnyLabel = rawEvent.tags.some((tag) => tag[0] === "l")
  if (hasAnyLabel && !hasHashtreeLabel) {
    return null
  }

  const hashHex = rawEvent.tags.find((tag) => tag[0] === "hash")?.[1]
  if (
    typeof hashHex !== "string" ||
    !/^[0-9a-f]{64}$/i.test(hashHex) ||
    typeof rawEvent.id !== "string" ||
    typeof rawEvent.created_at !== "number"
  ) {
    return null
  }

  const keyHex = rawEvent.tags.find((tag) => tag[0] === "key")?.[1]

  try {
    return {
      root: {
        hash: fromHex(hashHex),
        key: keyHex ? fromHex(keyHex) : undefined,
      },
      eventId: rawEvent.id,
      createdAt: rawEvent.created_at,
    }
  } catch {
    return null
  }
}

function compareTreeRootEvents(
  left: TreeRootEventSnapshot,
  right: TreeRootEventSnapshot
): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt
  }
  return left.eventId.localeCompare(right.eventId)
}

async function resolveLatestProfileSearchTreeRoot(
  npub: string,
  treeName: string
): Promise<TreeRootEventSnapshot | null> {
  try {
    const decoded = nip19.decode(npub)
    if (decoded.type !== "npub" || typeof decoded.data !== "string") {
      return null
    }

    const ndkEvents = await nostr.fetchEvents({
      kinds: [30078],
      authors: [decoded.data],
      "#d": [treeName],
      limit: 20,
    })

    const candidates: TreeRootEventSnapshot[] = []
    for (const event of ndkEvents ?? []) {
      const parsed = parseTreeRootEvent(event.rawEvent() as any)
      if (parsed) {
        candidates.push(parsed)
      }
    }

    candidates.sort(compareTreeRootEvents)
    return candidates[candidates.length - 1] ?? null
  } catch (err) {
    warn("[Relay Worker] Failed to resolve latest profile search tree root:", err)
    return null
  }
}

let sourceBridge: ReturnType<typeof connectNostrSource> | undefined
let closeCacheBridge: (() => void) | undefined
let statusTimer: ReturnType<typeof setInterval> | undefined
const authRequests = new Map<
  string,
  {resolve: (event: Event) => void; reject: (error: Error) => void}
>()
function requestAuthSignature(_relay: string, event: EventTemplate): Promise<Event> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const timer = setTimeout(() => {
      authRequests.delete(id)
      reject(new Error("Authentication signing timed out"))
    }, 10000)
    authRequests.set(id, {
      resolve: (event) => {
        clearTimeout(timer)
        resolve(event)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      },
    })
    self.postMessage({type: "signAuth", id, event} satisfies WorkerResponse)
  })
}

async function initialize(
  relayUrls?: string[],
  initialSettings?: SettingsState,
  disableExtraRelayUrls: boolean = false
) {
  try {
    log("[Relay Worker] Starting initialization with relays:", relayUrls)
    allowSearchRelays = !disableExtraRelayUrls && !import.meta.env.VITE_USE_TEST_RELAY

    // Store settings
    if (initialSettings) {
      settings = initialSettings
      log("[Relay Worker] Settings initialized:", settings)
    }

    // One durable store backs event history, offline reads, and the pending outbox.
    log("[Relay Worker] Initializing event store...")
    cache = new EventCache()
    log("[Relay Worker] Event store ready")

    // Initialize NostrClient with relay connections
    const relaysToUse = buildWorkerRelayUrls({
      relayUrls,
      defaultRelayUrls: DEFAULT_WORKER_RELAYS,
      extraRelayUrls: parseExtraRelayUrls(
        import.meta.env.VITE_PROFILE_SEARCH_TREE_RELAYS
      ),
      disableExtraRelayUrls,
    })
    log("[Relay Worker] Creating NostrClient with relays:", relaysToUse)

    nostr = new NostrClient({
      explicitRelayUrls: relaysToUse,
      signAuthEvent: requestAuthSignature,
      verifyEvent: (event) => verifyRelayEvent(event, wasmVerifier),
      cacheAdapter: cache,
      enableOutboxModel: false,
    })

    // Lazy load wasm in background
    loadWasm()

    setRemoteProfileSearchTreeResolver(async (npub, treeName) =>
      resolveLatestProfileSearchTreeRoot(npub, treeName)
    )

    // Initialize search index from Dexie in background
    initSearchFromDexie()

    // Forward relay notices to main thread
    nostr.pool?.on("notice", (relay: Relay, notice: string) => {
      self.postMessage({
        type: "notice",
        relay: relay.url,
        notice,
      } as WorkerResponse)
    })

    // Connect to relays (non-blocking - don't wait for all relays)
    log("[Relay Worker] Starting relay connections...")
    nostr
      .connect()
      .then(() => {
        log(`[Relay Worker] Runtime initialized`)
      })
      .catch((err) => {
        error(`[Relay Worker] Relay connection error:`, err)
      })

    // Attach status listeners immediately
    nostr.pool?.relays.forEach((relay) => {
      attachRelayListeners(relay)
    })

    log(`[Relay Worker] Initialized with ${nostr.pool?.relays.size || 0} relays`)

    if (statusTimer) clearInterval(statusTimer)
    statusTimer = setInterval(broadcastRelayStatus, 2000)

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
  filters: EventFilter[],
  opts?: WorkerSubscribeOpts
) {
  if (!nostr) {
    error("[Relay Worker] NostrClient not initialized")
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

  let cacheUsage: CacheMode
  if (cacheOnly) {
    cacheUsage = CacheMode.ONLY_CACHE
  } else if (relayOnly) {
    cacheUsage = CacheMode.ONLY_RELAY
  } else {
    cacheUsage = CacheMode.PARALLEL
  }

  log(`[Relay Worker] Using cacheUsage: ${cacheUsage}`)

  // Enable groupable by default for relay subscriptions to batch requests
  // Cache-only subs don't need grouping (instant local response)
  const shouldGroup = cacheOnly ? false : (opts?.groupable ?? true)
  const groupableDelay = shouldGroup ? (opts?.groupableDelay ?? 100) : undefined

  const sub = nostr.subscribe(filters, {
    isolated: opts?.isolated,
    relayUrls:
      opts?.relayUrls ??
      (allowSearchRelays && filters.some((filter) => !!filter.search)
        ? SEARCH_RELAYS
        : undefined),
    closeOnEose: opts?.closeOnEose ?? cacheOnly,
    groupable: shouldGroup,
    groupableDelay,
    cacheUsage,
    waitForCacheBeforeRelays: opts?.waitForCacheBeforeRelays,
  })

  sub.on("event", (event: AppEvent, relay, _sub, fromCache) => {
    const rawEvent = event.rawEvent()
    self.postMessage({
      type: "event",
      subId,
      event: rawEvent,
      relay: relay?.url,
      fromCache,
    } as WorkerResponse)

    // Index profile events (kind 0) for search
    if (rawEvent.kind === 0) {
      try {
        const content = JSON.parse(rawEvent.content)
        const searchProfile = buildProfileSearchResult(
          rawEvent.pubkey,
          content,
          rawEvent.created_at
        )
        if (searchProfile) {
          updateSearchIndex(searchProfile)
        }
      } catch {
        // Invalid profile content, skip
      }
    }
  })

  // Pagination needs each source's boundary even when another relay or the
  // local cache delivered the same event first.
  if (opts?.isolated) {
    sub.on("event:dup", (event, relay, _elapsed, _sub, fromCache) => {
      self.postMessage({
        type: "event",
        subId,
        event: event instanceof AppEvent ? event.rawEvent() : event,
        relay: relay?.url,
        fromCache,
      } as WorkerResponse)
    })
  }

  sub.on("eose", () => {
    self.postMessage({
      type: "eose",
      subId,
      completion: sub.completion,
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
  if (!nostr) {
    self.postMessage({
      type: "error",
      id,
      error: "NostrClient not initialized",
    } as WorkerResponse)
    return
  }

  try {
    const runtime = nostr.getRuntime()
    const destinations = opts?.publishTo ?? ["relay"]
    if (!destinations.includes("relay")) {
      await runtime.ingest(eventData, opts?.source ?? "local")
      self.postMessage({type: "published", id} as WorkerResponse)
      return
    }
    if (opts?.connectedOnly) {
      relayUrls = runtime
        .getRelayStats()
        .filter(
          (relay) => relay.connected && (!relayUrls || relayUrls.includes(relay.url))
        )
        .map((relay) => relay.url)
      if (!relayUrls.length) throw new Error("No connected message server")
    }
    const result = await runtime.publish(eventData, {
      relays: relayUrls,
      requireAck: opts?.requireAck,
    })
    if (opts?.requireAck && !result.remoteAccepted)
      throw new Error("No relay confirmed the event.")
    if (!result.remoteAccepted && !result.queued)
      throw new Error("Publication was not accepted")
    self.postMessage({type: "published", id, publishResult: result} as WorkerResponse)
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
  if (!nostr) return []
  return nostr
    .getRuntime()
    .getRelayStats()
    .map((relay) => ({
      url: relay.url,
      status: relay.connected ? 5 : 0,
      stats: {attempts: 0, success: relay.connected ? 1 : 0},
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
  if (!nostr?.pool) return
  const relay = new Relay(url, undefined, nostr)
  attachRelayListeners(relay)
  nostr.pool.addRelay(relay) // This will connect automatically
  broadcastRelayStatus()
}

function handleRemoveRelay(url: string) {
  nostr?.pool.removeRelay(url)
  broadcastRelayStatus()
}
const pausedRelays = new Set<string>()
function applyRelayState() {
  nostr
    ?.getRuntime()
    .setRelays([...nostr.pool.relays.keys()].filter((url) => !pausedRelays.has(url)))
  broadcastRelayStatus()
}
function handleConnectRelay(url: string) {
  pausedRelays.delete(url)
  nostr?.pool.getRelay(url)
  applyRelayState()
}
function handleDisconnectRelay(url: string) {
  pausedRelays.add(url)
  applyRelayState()
}
function handleReconnectDisconnected(_reason: string) {
  applyRelayState()
  void nostr?.getRuntime().retryPending()
}
function handleBrowserOffline() {
  nostr?.getRuntime().setRelays([])
  broadcastRelayStatus()
}
function handleBrowserOnline() {
  handleReconnectDisconnected("Browser online")
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
        pubsub: nostr?.getRuntime().metrics(),
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

  if (statusTimer) clearInterval(statusTimer)
  sourceBridge?.close()
  closeCacheBridge?.()
  for (const pending of authRequests.values()) pending.reject(new Error("Worker closed"))
  authRequests.clear()
  void nostr?.close()
}

function handleUpdateSettings(newSettings: SettingsState) {
  log("[Relay Worker] Updating settings:", newSettings)
  settings = newSettings
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
  try {
    const data = e.data
    const {type, id, filters, event, relays, subscribeOpts, publishOpts} = data

    switch (type) {
      case "init":
        await initialize(relays, data.settings, data.disableExtraRelayUrls)
        break

      case "authSigned": {
        const request = id ? authRequests.get(id) : undefined
        if (request && id) {
          authRequests.delete(id)
          if (data.error) request.reject(new Error(data.error))
          else request.resolve(data.event as Event)
        }
        break
      }
      case "peerCache": {
        if (!data.port) break
        closeCacheBridge?.()
        closeCacheBridge = serveNostrSource(data.port, {
          id: "client-cache",
          query: async (filters, options) => {
            const report = await nostr
              .getRuntime()
              .query(filters, {...options, cache: "cache-only"})
            return {
              events: report.events.map((event) => ({
                event: verifyNostrEvent(event),
                source: localIndexSource("client-cache"),
                priority: SOURCE_PRIORITY_LOCAL_INDEX,
              })),
              complete: report.complete,
            }
          },
        })
        break
      }
      case "peerSource":
        if (data.port && nostr) {
          sourceBridge?.close()
          sourceBridge = connectNostrSource(data.port, "fips", "queued")
          nostr.getRuntime().addSource(sourceBridge.source)
        }
        break

      case "subscribe":
        if (id && filters) {
          handleSubscribe(id, filters as EventFilter[], subscribeOpts)
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
          void handleSearch(data.searchRequestId, data.searchQuery).catch((err) => {
            error("[Relay Worker] Search failed:", err)
            self.postMessage({
              type: "searchResult",
              searchRequestId: data.searchRequestId,
              searchResults: [],
              searchComplete: true,
            } as WorkerResponse)
          })
        }
        break

      case "ping":
        self.postMessage({type: "pong", id} as WorkerResponse)
        break

      default:
        warn("[Relay Worker] Unknown message type:", type)
    }
  } catch (err) {
    error("[Relay Worker] Message handler error:", err)
    self.postMessage({
      type: "error",
      error: err instanceof Error ? err.message : String(err),
    })
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
