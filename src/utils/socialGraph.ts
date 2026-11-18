import {DEFAULT_RELAYS, LEGACY_PRODUCTION_RELAYS} from "@/shared/constants/relays"
import {SocialGraph, type NostrEvent} from "nostr-social-graph"
import type {DiscoveryLimits} from "./discoverySnapshot"
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
import {getInjectedHtreeRelayUrl} from "@/utils/nativeHtree"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

export const DEFAULT_SOCIAL_GRAPH_ROOT = defaultGraph.root

export const DEFAULT_CRAWL_DEGREE = 3

// Start with empty graph - instant initialization
const currentPublicKey = useUserStore.getState().publicKey
let instance = new SocialGraph(currentPublicKey || DEFAULT_SOCIAL_GRAPH_ROOT)
let isInitialized = false
let canPersistGraph = true
interface SavedSocialGraph {
  data: Uint8Array
  readyRoot?: string
}
let readyGraphRoot: string | undefined

// Notify subscribers of graph changes via Zustand store
const notifyGraphChange = () => {
  useSocialGraphStore.getState().incrementVersion()
}

function usesDefaultGraphRelays(relays: string[]): boolean {
  return (
    !import.meta.env.VITE_USE_LOCAL_RELAY &&
    !import.meta.env.VITE_USE_TEST_RELAY &&
    !getInjectedHtreeRelayUrl() &&
    [DEFAULT_RELAYS, LEGACY_PRODUCTION_RELAYS].some(
      (defaults) =>
        relays.length === defaults.length && defaults.every((url) => relays.includes(url))
    )
  )
}

function allowsPublicGraphBootstrap(): boolean {
  const {relayConfigs} = useUserStore.getState()
  return usesDefaultGraphRelays(
    relayConfigs?.filter((config) => !config.disabled).map((config) => config.url) || []
  )
}

// A packaged fallback is useful immediately, but is not a personal crawl. Do
// not save it untouched: the next visit must be able to retry public discovery.
const packagedFallbacks = new WeakSet<SocialGraph>()
const retainedGraphs = new WeakSet<SocialGraph>()
let personalMutationVersion = 0
const pendingBootstrapGraphs = new WeakMap<SocialGraph, PublicBootstrap>()
interface PublicBootstrap {
  controller: AbortController
  updates: SocialGraph
  revision: number
  personal?: Promise<SocialGraph>
  unsubscribe: () => void
}
let publicBootstrap: PublicBootstrap | undefined
let installingPublicGraph = false
let catchupRequest: {generation: number; relays: string[]} | undefined

function cancelPublicBootstrap() {
  publicBootstrap?.controller.abort()
  publicBootstrap?.unsubscribe()
  publicBootstrap = undefined
}

function recordPersonalUpdates(events: NostrEvent | NostrEvent[]) {
  personalMutationVersion++
  packagedFallbacks.delete(instance)
  if (publicBootstrap?.updates.handleEvent(events, true, Infinity))
    publicBootstrap.revision++
}

function preparePublicBootstrap(publicKey: string, personal?: SocialGraph) {
  cancelPublicBootstrap()
  if (!canPersistGraph || !allowsPublicGraphBootstrap()) return
  const controller = new AbortController()
  const context: PublicBootstrap = {
    controller,
    updates: new SocialGraph(publicKey),
    revision: 0,
    unsubscribe: useUserStore.subscribe((state, previous) => {
      if (
        state.publicKey !== previous.publicKey ||
        state.relays !== previous.relays ||
        state.relayConfigs !== previous.relayConfigs
      )
        controller.abort()
    }),
  }
  publicBootstrap = context
  if (personal && !packagedFallbacks.has(personal)) {
    // Capture only retained/personal state before adding the packaged rows.
    context.personal = personal
      .toBinary()
      .then((bytes) => SocialGraph.fromBinary(publicKey, bytes))
  }
  return context
}

function refreshPublicGraph(
  bundled: SocialGraph,
  target: SocialGraph,
  isCurrent: () => boolean = () => true
) {
  const context = pendingBootstrapGraphs.get(bundled)
  pendingBootstrapGraphs.delete(bundled)
  if (!context) return
  const {controller} = context
  const current = () =>
    publicBootstrap === context &&
    !controller.signal.aborted &&
    instance === target &&
    isCurrent() &&
    allowsPublicGraphBootstrap()
  void (async () => {
    let ownsInstallation = false
    try {
      if (!current()) return
      const {loadGraphBootstrap} = await import("nostr-social-graph/publicGraphSync")
      const fresh = await loadGraphBootstrap({
        root: DEFAULT_SOCIAL_GRAPH_ROOT,
        minUsers: Math.max(10_000, Math.ceil(defaultGraph.users / 2)),
        signal: controller.signal,
      })
      if (!current()) return
      installingPublicGraph = true
      ownsInstallation = true
      stopGraphCatchup?.()
      stopGraphCatchup = undefined
      // Public partial rows replace packaged rows. Actual personal lists remain
      // authoritative, including events received while the download was pending.
      const personal = await context.personal
      for (let attempt = 0; attempt < 3 && current(); attempt++) {
        const revision = context.revision
        const replacement = await SocialGraph.fromBinary(
          target.getRoot(),
          await context.updates.toBinary()
        )
        if (personal) await replacement.merge(personal)
        await replacement.merge(fresh)
        if (!current()) return
        if (revision !== context.revision) continue
        instance = replacement
        notifyGraphChange()
        useSocialGraphStore.getState().incrementMuteListVersion()
        await saveToLocalForage()
        return
      }
    } catch (err) {
      log("Public graph bootstrap unavailable; retaining current graph", err)
    } finally {
      context.unsubscribe()
      const owned = publicBootstrap === context
      if (owned) publicBootstrap = undefined
      if (ownsInstallation) installingPublicGraph = false
      if (owned || ownsInstallation) {
        if (catchupRequest)
          void startGraphCatchup(catchupRequest.generation, catchupRequest.relays).catch(
            error
          )
      }
    }
  })()
}

async function loadPreCrawledGraph(
  publicKey: string,
  personal?: SocialGraph
): Promise<SocialGraph> {
  await useUserStore.getState().awaitHydration()
  const bootstrap = preparePublicBootstrap(publicKey, personal)
  let graph: SocialGraph
  try {
    const response = await fetch(bundledGraphUrl)
    if (!response.ok) throw new Error("Bundled social graph unavailable")
    graph = await SocialGraph.fromBinary(
      publicKey,
      new Uint8Array(await response.arrayBuffer())
    )
    log("loaded default binary social graph of size", graph.size())
  } catch (err) {
    error("Failed to load default social graph, using empty graph instead:", err)
    graph = new SocialGraph(publicKey)
  }
  packagedFallbacks.add(graph)
  if (bootstrap) pendingBootstrapGraphs.set(graph, bootstrap)
  return graph
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
  const target = instance
  const beforeMutations = personalMutationVersion
  const wasPackaged = packagedFallbacks.has(target)
  const hadPersonalData =
    target.size().follows > 0 ||
    target.size().mutes > 0 ||
    target.getListRevision(publicKey, 3) !== undefined ||
    target.getListRevision(publicKey, 10000) !== undefined
  const bundled = await loadPreCrawledGraph(publicKey, target)
  if (!isCurrent() || instance !== target) return
  // Merge into the retained graph: complete newer bootstrap lists may refresh
  // it, while partial projections cannot replace a locally crawled list.
  await target.merge(bundled)
  if (
    beforeMutations === personalMutationVersion &&
    (wasPackaged || (!hadPersonalData && !retainedGraphs.has(target)))
  ) {
    packagedFallbacks.add(target)
  }
  refreshPublicGraph(bundled, target, isCurrent)
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
        retainedGraphs.add(instance)
        readyGraphRoot = snapshot.readyRoot
        log("loaded local social graph of size", instance.size())
      } catch (err) {
        error("error deserializing", err)
        // Keep unreadable personal data recoverable and avoid replacing it.
        canPersistGraph = false
        instance = await loadInitialGraph(publicKey)
      }
    } else {
      log("no social graph found")
      await localForage.removeItem("socialGraph")
      instance = await loadInitialGraph(publicKey)
    }
  } catch (err) {
    error("Failed to load persisted social graph, using initial network instead:", err)
    canPersistGraph = false
    instance = await loadInitialGraph(publicKey)
  } finally {
    refreshPublicGraph(instance, instance)
    notifyGraphChange()
  }
}

const saveToLocalForage = async () => {
  if (!isInitialized || !canPersistGraph || packagedFallbacks.has(instance)) {
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
  recordPersonalUpdates(evs)
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
let graphCatchupRelaySettingsChanged = false

async function startGraphCatchup(generation: number, relays: string[]) {
  catchupRequest = {generation, relays}
  if (publicBootstrap || installingPublicGraph) return
  const {startGraphSync} = await import("nostr-social-graph/publicGraphSync")
  if (generation !== graphSyncGeneration || graphCatchupRelaySettingsChanged) return
  stopGraphCatchup?.()
  stopGraphCatchup = startGraphSync({
    getGraph: () => instance,
    relays:
      usesDefaultGraphRelays(relays) && allowsPublicGraphBootstrap()
        ? ["wss://graph-relay.iris.to", ...relays]
        : relays,
    maxAuthors: 500,
    maxBytes: 2 * 1024 * 1024,
    onEvent: recordPersonalUpdates,
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
      if (
        state.relays !== prevState.relays ||
        state.relayConfigs !== prevState.relayConfigs
      ) {
        // The client retains its startup relay array. Stop optional catch-up
        // until reload rather than keep using a relay the user just disabled.
        graphCatchupRelaySettingsChanged = true
        stopGraphCatchup?.()
        stopGraphCatchup = undefined
      }
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
  const version = useSocialGraphStore((state) => state.version)
  const muteVersion = useSocialGraphStore((state) => state.muteListVersion)
  return useMemo(() => {
    const {users: reachableUsers, follows, mutes, sizeByDistance} = instance.size()
    return {
      users: instance.getInternalData().ids.size,
      reachableUsers,
      follows,
      mutes,
      sizeByDistance,
    }
  }, [version, muteVersion])
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

function saveGraphBytes(data: Uint8Array, filename: string) {
  const url = URL.createObjectURL(
    new Blob([data.slice()], {type: "application/octet-stream"})
  )
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const saveToFile = async () => {
  saveGraphBytes(await instance.toBinary(), "social_graph.bin")
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
            cancelPublicBootstrap()
            canPersistGraph = true
            packagedFallbacks.delete(instance)
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

export type GraphImportMode = "merge" | "replace" | "save"

function activeGraphOperation() {
  const graph = instance
  const root = graph.getRoot()
  const account = useUserStore.getState().publicKey
  const generation = graphSyncGeneration
  function ensureCurrent() {
    if (
      instance !== graph ||
      graph.getRoot() !== root ||
      useUserStore.getState().publicKey !== account ||
      generation !== graphSyncGeneration
    ) {
      throw new Error("The active graph changed. Please try again.")
    }
  }
  return {graph, root, ensureCurrent}
}

export async function saveSizedLocalGraph(limits: DiscoveryLimits) {
  const active = activeGraphOperation()
  const {selectGraphBytes} = await import("./discoverySnapshot")
  const bytes = await selectGraphBytes(active.graph, limits)
  active.ensureCurrent()
  saveGraphBytes(bytes, "personal-social-graph.bin")
  return bytes.byteLength
}

export async function prepareGraphDownloads() {
  const {openGraphSnapshot} = await import("nostr-social-graph/hashtreeSnapshot")
  const snapshot = await openGraphSnapshot()
  const root = DEFAULT_SOCIAL_GRAPH_ROOT
  const mobile =
    snapshot.manifest.root === root
      ? snapshot.manifest.files["mobile.bin"]
      : snapshot.manifest.mobile_roots?.[root]
  let cachedMobile: Uint8Array | undefined
  async function readMobile() {
    if (cachedMobile) {
      return {
        bytes: cachedMobile,
        graph: await SocialGraph.fromBinary(root, cachedMobile),
      }
    }
    const {readMobileGraphSnapshot} =
      await import("nostr-social-graph/mobileGraphSnapshot")
    const verified = await readMobileGraphSnapshot(root, {snapshot})
    cachedMobile = verified.bytes
    return verified
  }
  const fullName = "social-graph-v4.bin"
  const fullBytes = snapshot.manifest.files[fullName].size
  return {
    mobileBytes: mobile?.size,
    fullBytes,
    async saveFull() {
      saveGraphBytes(await snapshot.readFile(fullName, {maxBytes: fullBytes}), fullName)
    },
    async importMobile(limits: DiscoveryLimits, mode: GraphImportMode) {
      if (!mobile) throw new Error("This snapshot has no Iris discovery graph")
      const active = activeGraphOperation()
      const {selectGraphBytes} = await import("./discoverySnapshot")
      const verified = await readMobile()
      const bytes = await selectGraphBytes(verified.graph, limits, verified.bytes)
      if (mode === "save") {
        saveGraphBytes(bytes, "iris-discovery-graph.bin")
        return bytes.byteLength
      }
      const selected =
        bytes === verified.bytes && verified.graph.getRoot() === active.root
          ? verified.graph
          : await SocialGraph.fromBinary(active.root, bytes)
      active.ensureCurrent()
      cancelPublicBootstrap()
      canPersistGraph = true
      packagedFallbacks.delete(instance)
      if (mode === "replace") {
        instance = selected
        readyGraphRoot = undefined
        setupSubscription(active.root)
        if (active.root !== DEFAULT_SOCIAL_GRAPH_ROOT)
          getFollowListsInternal(active.root, false, 1)
      } else {
        await active.graph.merge(selected)
      }
      notifyGraphChange()
      await saveToLocalForage()
      return bytes.byteLength
    },
  }
}

export const loadAndMerge = () => loadFromFile(true)

export const clearGraph = async () => {
  cancelPublicBootstrap()
  canPersistGraph = true
  readyGraphRoot = undefined
  instance = new SocialGraph(instance.getRoot())
  notifyGraphChange()
  await saveToLocalForage()
  log("Cleared social graph")
}

export const resetGraph = async () => {
  canPersistGraph = true
  readyGraphRoot = undefined
  const root = instance.getRoot()
  instance = await loadPreCrawledGraph(root)
  refreshPublicGraph(instance, instance)
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
