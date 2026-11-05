import {DEFAULT_RELAYS} from "@/shared/constants/relays"
import {SocialGraph, type NostrEvent} from "nostr-social-graph"
import {EventSubscription, CacheMode, type EventFilter} from "@/lib/nostr"
import {useUserStore} from "@/stores/user"
import {useSocialGraphStore} from "@/stores/socialGraph"
import {VerifiedEvent} from "nostr-tools"
import debounce from "lodash/debounce"
import throttle from "lodash/throttle"
import localForage from "localforage"
import bundledGraphUrl from "@/assets/socialGraph.bin?url"
import defaultGraph from "@/assets/socialGraph.json"
// Removed static import to avoid race condition - use dynamic import in setupSubscription
import {useMemo} from "react"
import {KIND_CONTACTS, KIND_MUTE_LIST, DEBUG_NAMESPACES} from "@/utils/constants"
import {createDebugLogger} from "@/utils/createDebugLogger"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

export const DEFAULT_SOCIAL_GRAPH_ROOT = defaultGraph.root

export const DEFAULT_CRAWL_DEGREE = 3

// Start with empty graph - instant initialization
const currentPublicKey = useUserStore.getState().publicKey
let instance = new SocialGraph(currentPublicKey || DEFAULT_SOCIAL_GRAPH_ROOT)
let isInitialized = false
interface SavedSocialGraph {
  data: Uint8Array
  readyRoot?: string
}
let readyGraphRoot: string | undefined

// Notify subscribers of graph changes via Zustand store
const notifyGraphChange = () => {
  useSocialGraphStore.getState().incrementVersion()
}

async function loadPreCrawledGraph(publicKey: string): Promise<SocialGraph> {
  try {
    const {loadGraphBootstrap} = await import("nostr-social-graph/publicGraphSync")
    const graph = await loadGraphBootstrap({root: DEFAULT_SOCIAL_GRAPH_ROOT})
    await graph.setRoot(publicKey)
    return graph
  } catch {
    /* The pinned asset remains the offline/bootstrap fallback. */
  }
  try {
    const response = await fetch(bundledGraphUrl)
    const binaryData = new Uint8Array(await response.arrayBuffer())
    const graph = await SocialGraph.fromBinary(publicKey, binaryData)
    log("loaded default binary social graph of size", graph.size())
    return graph
  } catch (err) {
    // In tests and some environments this asset URL isn't fetchable; fall back to an empty graph.
    error("Failed to load default social graph, using empty graph instead:", err)
    return new SocialGraph(publicKey)
  }
}

// A signed-in user's own contacts and mutes are the startup authority. The
// bundled discovery graph is only needed when that user has no personal network.
const loadInitialGraph = (publicKey: string) =>
  useUserStore.getState().publicKey === publicKey
    ? Promise.resolve(new SocialGraph(publicKey))
    : loadPreCrawledGraph(publicKey)

let defaultNetworkLoad:
  {publicKey: string; generation: number; promise: Promise<void>} | undefined

function ensureDefaultNetwork(publicKey: string, isCurrent: () => boolean) {
  if (
    defaultNetworkLoad?.publicKey === publicKey &&
    defaultNetworkLoad.generation === graphSyncGeneration
  ) {
    return defaultNetworkLoad.promise
  }
  if (instance.getFollowedByUser(DEFAULT_SOCIAL_GRAPH_ROOT).size > 0) {
    return Promise.resolve()
  }
  const loading = {
    publicKey,
    generation: graphSyncGeneration,
    promise: loadDefaultNetwork(publicKey, isCurrent),
  }
  defaultNetworkLoad = loading
  const clearLoading = () => {
    if (defaultNetworkLoad === loading) defaultNetworkLoad = undefined
  }
  void loading.promise.then(clearLoading, clearLoading)
  return loading.promise
}

async function loadDefaultNetwork(publicKey: string, isCurrent: () => boolean) {
  useSocialGraphStore.getState().setReady(false)
  const bundled = await loadPreCrawledGraph(publicKey)
  if (!isCurrent()) return
  // Merge into the retained graph: complete newer bootstrap lists may refresh
  // it, while partial projections cannot replace a locally crawled list.
  await instance.merge(bundled)
}

async function initializeInstance(publicKey = DEFAULT_SOCIAL_GRAPH_ROOT) {
  if (isInitialized) {
    log("setting root", publicKey)
    await instance.setRoot(publicKey)
    notifyGraphChange()
    return
  }
  isInitialized = true

  try {
    const saved = await localForage.getItem<Uint8Array | SavedSocialGraph>("socialGraph")
    if (saved) {
      try {
        const snapshot = saved instanceof Uint8Array ? {data: saved} : saved
        instance = await SocialGraph.fromBinary(publicKey, snapshot.data)
        readyGraphRoot = snapshot.readyRoot
        log("loaded local social graph of size", instance.size())
      } catch (err) {
        error("error deserializing", err)
        await localForage.removeItem("socialGraph")
        instance = await loadInitialGraph(publicKey)
      }
    } else {
      log("no social graph found")
      await localForage.removeItem("socialGraph")
      instance = await loadInitialGraph(publicKey)
    }
  } catch (err) {
    error("Failed to load persisted social graph, using initial network instead:", err)
    instance = await loadInitialGraph(publicKey)
  } finally {
    notifyGraphChange()
  }
}

const saveToLocalForage = async () => {
  if (!isInitialized) {
    return
  }

  try {
    const readyRoot =
      useSocialGraphStore.getState().isReady && readyGraphRoot === instance.getRoot()
        ? readyGraphRoot
        : undefined
    const serialized = await instance.toBinary()
    await localForage.setItem("socialGraph", {data: serialized, readyRoot})
    log("Saved social graph of size", instance.size())
  } catch (err) {
    error("failed to serialize SocialGraph or UniqueIds", err)
    log("social graph size", instance.size())
  }
}

const throttledSave = throttle(saveToLocalForage, 15000)

const debouncedRemoveNonFollowed = debounce(() => {
  /* temp removed until better perf
  const removedCount = instance.removeMutedNotFollowedUsers()
  console.log("Removing", removedCount, "muted users not followed by anyone")
  */
  throttledSave()
}, 11000)

// Throttled mute list update notification
const throttledMuteListUpdate = throttle(() => {
  useSocialGraphStore.getState().incrementMuteListVersion()
}, 1000)

export const handleSocialGraphEvent = (evs: NostrEvent | Array<NostrEvent>) => {
  const events = Array.isArray(evs) ? evs : [evs]
  const hasMuteListUpdate = events.some((e) => e.kind === KIND_MUTE_LIST)
  const hasFollowListUpdate = events.some((e) => e.kind === KIND_CONTACTS)

  // Relays and overlapping subscriptions often repeat the same contact list.
  // An ignored event must not trigger another graph render, save, or traversal.
  if (!instance.handleEvent(evs)) return false
  throttledSave()

  if (hasMuteListUpdate) {
    throttledMuteListUpdate()
  }

  // Notify subscribers of follow list changes
  if (hasFollowListUpdate) {
    notifyGraphChange()
  }
  return true
}

let sub: EventSubscription | undefined
let isManualRecrawling = false
let graphSyncGeneration = 0
let unsubscribeFromUserStore: (() => void) | undefined
let activeGraphSync: {publicKey: string; promise: Promise<void>} | undefined
const activeOpinionSubscriptions = new Set<EventSubscription>()
let stopGraphCatchup: (() => void) | undefined

async function startGraphCatchup(generation: number, relays: string[]) {
  const {startGraphSync} = await import("nostr-social-graph/publicGraphSync")
  if (generation !== graphSyncGeneration) return
  stopGraphCatchup?.()
  stopGraphCatchup = startGraphSync({
    getGraph: () => instance,
    relays:
      relays.length === DEFAULT_RELAYS.length &&
      relays.every((url) => DEFAULT_RELAYS.includes(url))
        ? ["wss://graph-relay.iris.to", ...relays]
        : relays,
    maxAuthors: 500,
    maxBytes: 2 * 1024 * 1024,
    onChange: () => {
      if (generation !== graphSyncGeneration) return
      notifyGraphChange()
      useSocialGraphStore.getState().incrementMuteListVersion()
      throttledSave()
    },
    onError: error,
  })
}

const INITIAL_SYNC_SETTLE_MS = 300
const INITIAL_SYNC_TIMEOUT_MS = 8_000

function getFollowListsInternal(
  myPubKey: string,
  missingOnly = true,
  upToDistance = 1,
  isManual = false,
  isCurrent: () => boolean = () => true
) {
  if (!isCurrent()) return
  const toFetch = new Set<string>()

  const addUsersToFetch = (users: Set<string>, currentDistance: number) => {
    for (const user of users) {
      if (!missingOnly || instance.getFollowedByUser(user).size === 0) {
        toFetch.add(user)
      }
    }

    if (currentDistance < upToDistance) {
      for (const user of users) {
        const nextLevelUsers = instance.getFollowedByUser(user)
        addUsersToFetch(nextLevelUsers, currentDistance + 1)
      }
    }
  }

  const myFollows = instance.getFollowedByUser(myPubKey)
  addUsersToFetch(myFollows, 1)

  log("fetching", toFetch.size, missingOnly ? "missing" : "total", "follow lists")

  const fetchBatch = async (authors: string[]) => {
    if (!isCurrent() || (isManual && !isManualRecrawling)) return

    const {nostr: getNdk, initNostr} = await import("@/utils/nostrClient")
    if (!isCurrent()) return
    initNostr() // Init in background - messages queue until ready
    const sub = getNdk().subscribe(
      {
        kinds: [KIND_CONTACTS, KIND_MUTE_LIST],
        authors: authors,
      },
      {closeOnEose: true}
    )

    sub.on("event", (e: unknown) => {
      if (!isCurrent()) return
      handleSocialGraphEvent(e as unknown as VerifiedEvent)
      debouncedRemoveNonFollowed()
    })
  }

  const processBatch = () => {
    if (!isCurrent() || (isManual && !isManualRecrawling)) {
      return
    }

    const batch = [...toFetch].slice(0, 500)
    if (batch.length > 0) {
      fetchBatch(batch)
      batch.forEach((author) => toFetch.delete(author))
      if (toFetch.size > 0) {
        setTimeout(() => {
          processBatch()
        }, 1000)
      } else if (isManual) {
        isManualRecrawling = false
        useSocialGraphStore.getState().setIsRecrawling(false)
      }
    } else if (isManual) {
      isManualRecrawling = false
      useSocialGraphStore.getState().setIsRecrawling(false)
    }
  }

  processBatch()
}

export function getFollowLists(myPubKey: string, missingOnly = true, upToDistance = 1) {
  isManualRecrawling = true
  useSocialGraphStore.getState().setIsRecrawling(true)
  getFollowListsInternal(myPubKey, missingOnly, upToDistance, true)
}

function getMissingFollowLists(myPubKey: string, isCurrent: () => boolean) {
  getFollowListsInternal(myPubKey, true, 1, false, isCurrent)
}

let resolveLoaded: ((value: boolean) => void) | null = null

export const socialGraphLoaded = new Promise<boolean>((resolve) => {
  resolveLoaded = resolve
})

// Initialize social graph (separate from subscription setup)
export const initializeSocialGraph = async () => {
  const publicKeyAtStart = useUserStore.getState().publicKey
  try {
    await initializeInstance(publicKeyAtStart || undefined)
  } catch (err) {
    error("Failed to initialize social graph, using an empty graph instead:", err)
    instance = new SocialGraph(publicKeyAtStart || DEFAULT_SOCIAL_GRAPH_ROOT)
    notifyGraphChange()
  } finally {
    // Authentication can change while IndexedDB/the bundled graph is loading.
    // Reconcile the current state instead of trusting the captured key.
    const currentPublicKey = useUserStore.getState().publicKey
    if (!currentPublicKey) {
      await instance.setRoot(DEFAULT_SOCIAL_GRAPH_ROOT)
    }
    resolveLoaded?.(true)
  }
}

// Setup subscription (called after NostrClient is ready)
export const setupSocialGraphSubscriptions = async () => {
  const requestGraphSync = (publicKey: string) => {
    if (activeGraphSync?.publicKey === publicKey) {
      return activeGraphSync.promise
    }

    const promise = (
      publicKey ? setupSubscription(publicKey) : resetSubscriptionToDefault()
    ).catch((err) => {
      error("Failed to synchronize social graph:", err)
      const expectedRoot = publicKey || DEFAULT_SOCIAL_GRAPH_ROOT
      if (
        useUserStore.getState().publicKey === publicKey &&
        instance.getRoot() === expectedRoot
      ) {
        // The persisted graph is still a valid stable snapshot when relays or
        // the worker fail to initialize; do not leave the feed spinning forever.
        notifyGraphChange()
        useSocialGraphStore.getState().incrementMuteListVersion()
        useSocialGraphStore.getState().setReady(true)
      }
    })
    const requestedSync = {publicKey, promise}
    activeGraphSync = requestedSync
    void promise.finally(() => {
      if (activeGraphSync === requestedSync) activeGraphSync = undefined
    })
    return promise
  }

  // Install the watcher before awaiting the initial sync. A cold graph can take
  // several seconds to hydrate, during which login/logout must not be missed.
  if (!unsubscribeFromUserStore) {
    unsubscribeFromUserStore = useUserStore.subscribe((state, prevState) => {
      if (state.publicKey !== prevState.publicKey) {
        void requestGraphSync(state.publicKey)
      }
    })
  }

  const publicKeyAtStart = useUserStore.getState().publicKey
  const expectedRoot = publicKeyAtStart || DEFAULT_SOCIAL_GRAPH_ROOT
  if (
    useSocialGraphStore.getState().isReady &&
    instance.getRoot() === expectedRoot &&
    (!publicKeyAtStart || !!sub)
  ) {
    return
  }
  await requestGraphSync(publicKeyAtStart)

  // If auth changed at the boundary of the initial await, join the current
  // request before reporting subscription setup as complete.
  const currentPublicKey = useUserStore.getState().publicKey
  if (currentPublicKey !== publicKeyAtStart) {
    const currentRoot = currentPublicKey || DEFAULT_SOCIAL_GRAPH_ROOT
    if (instance.getRoot() !== currentRoot || !useSocialGraphStore.getState().isReady) {
      await requestGraphSync(currentPublicKey)
    }
  }
}

// Auto-initialize on module load
initializeSocialGraph().catch((err) => {
  error("Failed to initialize social graph:", err)
})

/**
 * Hook that returns follows for a user and re-renders when the social graph changes.
 * This replaces the need to wait for socialGraphLoaded before rendering.
 */
export const useFollowsFromGraph = (
  pubKey: string | null | undefined,
  includeSelf = false
): string[] => {
  // Subscribe to graph version changes via Zustand store
  const version = useSocialGraphStore((state) => state.version)

  // Compute follows when version changes
  return useMemo(() => {
    if (!pubKey) return []
    const followSet = instance.getFollowedByUser(pubKey, includeSelf)
    return Array.from(followSet)
  }, [pubKey, includeSelf, version])
}

/**
 * Hook that returns whether a user is followed.
 * Re-renders when the social graph changes.
 */
export const useIsFollowing = (
  follower: string | null | undefined,
  followedUser: string | null | undefined
): boolean => {
  // Subscribe to graph version changes via Zustand store
  useSocialGraphStore((state) => state.version)

  if (!follower || !followedUser) return false
  return instance.isFollowing(follower, followedUser)
}

/**
 * Hook that returns the current graph size info.
 * Useful for debugging and showing loading progress.
 */
export const useGraphSize = () => {
  // Subscribe to graph version changes via Zustand store
  useSocialGraphStore((state) => state.version)
  useSocialGraphStore((state) => state.muteListVersion)
  return instance.size()
}

const isCurrentGraphSync = (syncGeneration: number, publicKey: string) =>
  syncGeneration === graphSyncGeneration &&
  useUserStore.getState().publicKey === publicKey &&
  instance.getRoot() === publicKey

const stopGraphSyncSubscriptions = () => {
  stopGraphCatchup?.()
  stopGraphCatchup = undefined
  const previousSub = sub
  sub = undefined
  previousSub?.stop()
  activeOpinionSubscriptions.forEach((opinionSub) => opinionSub.stop())
  activeOpinionSubscriptions.clear()
}

async function resetSubscriptionToDefault() {
  const syncGeneration = ++graphSyncGeneration
  useSocialGraphStore.getState().setReady(false)
  stopGraphSyncSubscriptions()

  await instance.setRoot(DEFAULT_SOCIAL_GRAPH_ROOT)
  if (syncGeneration !== graphSyncGeneration || useUserStore.getState().publicKey) {
    return
  }

  await ensureDefaultNetwork(
    DEFAULT_SOCIAL_GRAPH_ROOT,
    () => syncGeneration === graphSyncGeneration && !useUserStore.getState().publicKey
  )
  if (syncGeneration !== graphSyncGeneration || useUserStore.getState().publicKey) return

  notifyGraphChange()
  useSocialGraphStore.getState().incrementMuteListVersion()
  useSocialGraphStore.getState().setReady(true)
  const {nostr, initNostr} = await import("@/utils/nostrClient")
  await initNostr()
  void startGraphCatchup(syncGeneration, nostr().explicitRelayUrls).catch(error)
}

async function setupSubscription(publicKey: string) {
  const syncGeneration = ++graphSyncGeneration
  useSocialGraphStore.getState().setReady(false)
  stopGraphSyncSubscriptions()

  await instance.setRoot(publicKey)
  if (!isCurrentGraphSync(syncGeneration, publicKey)) return
  notifyGraphChange()

  // Returning visitors already have a complete local visibility snapshot.
  // Refresh it over the open subscriptions below without making feed startup
  // depend on every configured relay completing its history response.
  // A completed snapshot may legitimately have no contact event (for example,
  // a read-only/new account using discovery). Its ready marker is sufficient;
  // requiring kind 3 made every reload wait for silent relays again.
  if (readyGraphRoot === publicKey) {
    useSocialGraphStore.getState().setReady(true)
  }

  // Import nostr lazily to avoid initialization race
  const {nostr: getNdk, initNostr} = await import("@/utils/nostrClient")
  await initNostr()
  if (!isCurrentGraphSync(syncGeneration, publicKey)) return

  const rootFilters = [
    {kinds: [KIND_CONTACTS], authors: [publicKey], limit: 1},
    {kinds: [KIND_MUTE_LIST], authors: [publicKey], limit: 1},
  ]
  const initialSyncDeadline = Date.now() + INITIAL_SYNC_TIMEOUT_MS
  const initialSubscriptions = new Set<EventSubscription>()
  // Each configured relay has an independent historical boundary. An absent
  // relay must not hold a complete root/mute snapshot from a healthy one.
  const relayUrls = getNdk().explicitRelayUrls
  const historyRelays = relayUrls.length ? relayUrls : [undefined]
  const subscribeHistory = (
    filters: EventFilter | EventFilter[],
    onEvent: (event: NostrEvent) => void
  ) => {
    let settled = false
    let complete = false
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    let finish!: () => void
    const promise = new Promise<void>((resolve) => {
      finish = () => {
        if (settled) return
        settled = true
        if (settleTimer) clearTimeout(settleTimer)
        clearTimeout(cutoffTimer)
        resolve()
      }
    })
    const cutoffTimer = setTimeout(finish, Math.max(0, initialSyncDeadline - Date.now()))
    const settle = () => {
      if (settled || !complete || !isCurrentGraphSync(syncGeneration, publicKey)) return
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(
        finish,
        Math.min(INITIAL_SYNC_SETTLE_MS, Math.max(0, initialSyncDeadline - Date.now()))
      )
    }
    for (const relayUrl of historyRelays) {
      const subscription = getNdk().subscribe(filters, {
        transports: ["worker-transport"],
        relayUrls: relayUrl ? [relayUrl] : undefined,
        isolated: true,
        waitForCacheBeforeRelays: true,
      })
      initialSubscriptions.add(subscription)
      activeOpinionSubscriptions.add(subscription)
      subscription.on("event", (event: NostrEvent) => {
        onEvent(event)
        settle()
      })
      subscription.on("eose", () => {
        if (
          subscription.completion?.complete &&
          subscription.completion.reason === "eose"
        ) {
          complete = true
          settle()
        }
      })
      subscription.on("close", () => {
        if (!isCurrentGraphSync(syncGeneration, publicKey)) finish()
      })
    }
    return promise
  }

  let latestTime = 0
  let initialSyncDone = false
  const handleRootEvent = (ev: {kind?: number; created_at?: number}) => {
    if (!isCurrentGraphSync(syncGeneration, publicKey)) return
    if (ev.kind === KIND_MUTE_LIST) {
      handleSocialGraphEvent(ev as NostrEvent)
      return
    }
    if (typeof ev.created_at !== "number" || ev.created_at < latestTime) {
      return
    }
    latestTime = ev.created_at
    if (handleSocialGraphEvent(ev as NostrEvent)) {
      void instance.recalculateFollowDistances().then(() => {
        if (isCurrentGraphSync(syncGeneration, publicKey)) notifyGraphChange()
      })
    }

    if (initialSyncDone) {
      if (instance.getFollowedByUser(publicKey).size === 0) {
        void ensureDefaultNetwork(publicKey, () =>
          isCurrentGraphSync(syncGeneration, publicKey)
        )
          .then(() => {
            if (isCurrentGraphSync(syncGeneration, publicKey)) {
              notifyGraphChange()
              useSocialGraphStore.getState().setReady(true)
            }
          })
          .catch(error)
      }
      queueMicrotask(() =>
        getMissingFollowLists(publicKey, () =>
          isCurrentGraphSync(syncGeneration, publicKey)
        )
      )
    }
  }

  const opinionBatches: Promise<void>[] = []
  const requestedAuthors = new Set<string>()
  const hydrateDirectFollowOpinions = () => {
    if (
      !isCurrentGraphSync(syncGeneration, publicKey) ||
      Date.now() >= initialSyncDeadline
    )
      return
    const authors = Array.from(instance.getFollowedByUser(publicKey)).filter(
      (author) => !requestedAuthors.has(author)
    )
    for (let index = 0; index < authors.length; index += 500) {
      const authorsBatch = authors.slice(index, index + 500)
      authorsBatch.forEach((author) => requestedAuthors.add(author))
      opinionBatches.push(
        subscribeHistory(
          {kinds: [KIND_CONTACTS, KIND_MUTE_LIST], authors: authorsBatch},
          (event) => {
            if (isCurrentGraphSync(syncGeneration, publicKey)) {
              handleSocialGraphEvent(event)
            }
          }
        )
      )
    }
  }
  // Start opinions from the cached graph immediately, then extend the same
  // hydration as root contacts arrive instead of waiting for root EOSE first.
  const rootHistory = subscribeHistory(rootFilters, (event) => {
    handleRootEvent(event)
    hydrateDirectFollowOpinions()
  })
  hydrateDirectFollowOpinions()
  await rootHistory
  if (!isCurrentGraphSync(syncGeneration, publicKey)) return
  if (instance.getFollowedByUser(publicKey).size === 0) {
    await ensureDefaultNetwork(publicKey, () =>
      isCurrentGraphSync(syncGeneration, publicKey)
    )
    if (!isCurrentGraphSync(syncGeneration, publicKey)) return
  }
  let completedBatches = 0
  while (completedBatches < opinionBatches.length) {
    const pending = opinionBatches.slice(completedBatches)
    completedBatches = opinionBatches.length
    await Promise.all(pending)
    if (!isCurrentGraphSync(syncGeneration, publicKey)) return
    hydrateDirectFollowOpinions()
  }
  // Freeze the hydration phase before publishing readiness. Everything after
  // this point is eventual background sync for future feed mounts.
  initialSubscriptions.forEach((subscription) => {
    activeOpinionSubscriptions.delete(subscription)
    subscription.stop()
  })
  if (!isCurrentGraphSync(syncGeneration, publicKey)) return

  await instance.recalculateFollowDistances()
  if (!isCurrentGraphSync(syncGeneration, publicKey)) return
  notifyGraphChange()
  useSocialGraphStore.getState().incrementMuteListVersion()

  initialSyncDone = true

  const backgroundRootSub = getNdk().subscribe(rootFilters, {
    transports: ["worker-transport"],
    cacheUsage: CacheMode.ONLY_RELAY,
  })
  backgroundRootSub.on("event", handleRootEvent)
  if (!isCurrentGraphSync(syncGeneration, publicKey)) {
    backgroundRootSub.stop()
    return
  }
  sub = backgroundRootSub

  const directFollowAuthors = Array.from(instance.getFollowedByUser(publicKey))
  for (let index = 0; index < directFollowAuthors.length; index += 500) {
    if (!isCurrentGraphSync(syncGeneration, publicKey)) return
    const authorsBatch = directFollowAuthors.slice(index, index + 500)
    const backgroundOpinionSub = getNdk().subscribe(
      {
        kinds: [KIND_CONTACTS, KIND_MUTE_LIST],
        authors: authorsBatch,
      },
      {
        transports: ["worker-transport"],
        cacheUsage: CacheMode.ONLY_RELAY,
      }
    )
    backgroundOpinionSub.on("event", (event) => {
      if (!isCurrentGraphSync(syncGeneration, publicKey)) return
      if (handleSocialGraphEvent(event as NostrEvent)) {
        void instance.recalculateFollowDistances().then(() => {
          if (isCurrentGraphSync(syncGeneration, publicKey)) notifyGraphChange()
        })
      }
    })
    if (!isCurrentGraphSync(syncGeneration, publicKey)) {
      backgroundOpinionSub.stop()
      return
    }
    activeOpinionSubscriptions.add(backgroundOpinionSub)
  }

  if (!isCurrentGraphSync(syncGeneration, publicKey)) return
  void startGraphCatchup(syncGeneration, relayUrls).catch(error)
  readyGraphRoot = publicKey
  useSocialGraphStore.getState().setReady(true)
  await saveToLocalForage()
}

export const saveToFile = async () => {
  const data = await instance.toBinary()
  const url = URL.createObjectURL(
    new File([data.slice()], "social_graph.bin", {
      type: "application/octet-stream",
    })
  )
  const a = document.createElement("a")
  a.href = url
  a.download = "social_graph.bin"
  a.click()
}

export const loadFromFile = (merge = false) => {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = ".bin"
  input.multiple = false
  input.onchange = () => {
    if (input.files?.length) {
      const file = input.files[0]
      file.arrayBuffer().then((buffer) => {
        try {
          const data = new Uint8Array(buffer)
          SocialGraph.fromBinary(instance.getRoot(), data).then(async (newInstance) => {
            if (merge) {
              await instance.merge(newInstance)
            } else {
              instance = newInstance
              readyGraphRoot = undefined
            }
            notifyGraphChange()
            await saveToLocalForage()
          })
        } catch (err) {
          error("failed to load social graph from file:", err)
        }
      })
    }
  }
  input.click()
}

export interface DownloadGraphOptions {
  maxNodes?: number
  maxEdges?: number
  maxDistance?: number
  maxEdgesPerNode?: number
  format?: string
  onDownloaded?: (bytes: number) => void
}

export const downloadLargeGraph = (options: DownloadGraphOptions = {}) => {
  const {
    maxNodes = 50000,
    maxEdges,
    maxDistance,
    maxEdgesPerNode,
    format = "binary",
    onDownloaded,
  } = options

  const params = new URLSearchParams()
  if (maxNodes) params.append("maxNodes", String(maxNodes))
  if (maxEdges) params.append("maxEdges", String(maxEdges))
  if (maxDistance) params.append("maxDistance", String(maxDistance))
  if (maxEdgesPerNode) params.append("maxEdgesPerNode", String(maxEdgesPerNode))
  if (format) params.append("format", format)

  const url = `https://graph-api.iris.to/social-graph?${params.toString()}`

  fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      if (!response.body) {
        throw new Error("Response body is null")
      }

      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let totalBytes = 0

      return new Promise<ArrayBuffer>((resolve, reject) => {
        function readChunk() {
          reader
            .read()
            .then(({done, value}) => {
              if (done) {
                // Combine all chunks into a single ArrayBuffer
                const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
                const result = new Uint8Array(totalLength)
                let offset = 0
                for (const chunk of chunks) {
                  result.set(chunk, offset)
                  offset += chunk.length
                }
                resolve(result.buffer)
                return
              }

              chunks.push(value)
              totalBytes += value.length
              if (onDownloaded) onDownloaded(totalBytes)
              readChunk()
            })
            .catch(reject)
        }

        readChunk()
      })
    })
    .then((data) => {
      return SocialGraph.fromBinary(instance.getRoot(), new Uint8Array(data))
    })
    .then(async (newInstance) => {
      instance = newInstance
      readyGraphRoot = undefined
      await instance.recalculateFollowDistances()
      notifyGraphChange()
      throttledSave()

      setupSubscription(instance.getRoot())
      const root = instance.getRoot()
      if (root && root !== DEFAULT_SOCIAL_GRAPH_ROOT) {
        getFollowListsInternal(root, false, 1)
      }
    })
    .catch((err) => {
      error("failed to load large social graph:", err)
    })
}

export const loadAndMerge = () => loadFromFile(true)

export const clearGraph = async () => {
  readyGraphRoot = undefined
  instance = new SocialGraph(instance.getRoot())
  notifyGraphChange()
  await saveToLocalForage()
  log("Cleared social graph")
}

export const resetGraph = async () => {
  readyGraphRoot = undefined
  const root = instance.getRoot()
  instance = await loadPreCrawledGraph(root)
  notifyGraphChange()
  await saveToLocalForage()
  log("Reset social graph to default")
}

export const stopRecrawl = () => {
  if (isManualRecrawling) {
    isManualRecrawling = false
    useSocialGraphStore.getState().setIsRecrawling(false)
    throttledSave()
  }
}

/**
 * Hook that returns the social graph instance and subscribes to changes.
 * Components using this hook will re-render when the graph changes.
 */
export const useSocialGraph = () => {
  // Subscribe to graph version changes via Zustand store
  useSocialGraphStore((state) => state.version)
  return instance
}

/**
 * Get the social graph instance directly (for non-React contexts).
 * Use useSocialGraph() in components for automatic re-rendering.
 */
export const getSocialGraph = () => instance
