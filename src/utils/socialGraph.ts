import {SocialGraph, type NostrEvent} from "nostr-social-graph"
import {NDKSubscription, NDKSubscriptionCacheUsage} from "@/lib/ndk"
import {useUserStore} from "@/stores/user"
import {useSocialGraphStore} from "@/stores/socialGraph"
import {VerifiedEvent} from "nostr-tools"
import debounce from "lodash/debounce"
import throttle from "lodash/throttle"
import localForage from "localforage"
// Removed static import to avoid race condition - use dynamic import in setupSubscription
import {useMemo} from "react"
import {KIND_CONTACTS, KIND_MUTE_LIST, DEBUG_NAMESPACES} from "@/utils/constants"
import {createDebugLogger} from "@/utils/createDebugLogger"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

export const DEFAULT_SOCIAL_GRAPH_ROOT =
  "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0"

export const DEFAULT_CRAWL_DEGREE = 3

// Start with empty graph - instant initialization
const currentPublicKey = useUserStore.getState().publicKey
let instance = new SocialGraph(currentPublicKey || DEFAULT_SOCIAL_GRAPH_ROOT)
let isInitialized = false

// Notify subscribers of graph changes via Zustand store
const notifyGraphChange = () => {
  useSocialGraphStore.getState().incrementVersion()
}

async function loadPreCrawledGraph(publicKey: string): Promise<SocialGraph> {
  try {
    const binaryUrl = (await import("nostr-social-graph/data/socialGraph.bin?url"))
      .default
    const response = await fetch(binaryUrl)
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

async function initializeInstance(publicKey = DEFAULT_SOCIAL_GRAPH_ROOT) {
  if (isInitialized) {
    log("setting root", publicKey)
    instance.setRoot(publicKey)
    notifyGraphChange()
    return
  }
  isInitialized = true

  try {
    const data = await localForage.getItem("socialGraph")
    if (data) {
      try {
        instance = await SocialGraph.fromBinary(publicKey, data as Uint8Array)
        log("loaded local social graph of size", instance.size())
      } catch (err) {
        error("error deserializing", err)
        await localForage.removeItem("socialGraph")
        instance = await loadPreCrawledGraph(publicKey)
      }
    } else {
      log("no social graph found")
      await localForage.removeItem("socialGraph")
      instance = await loadPreCrawledGraph(publicKey)
    }
  } catch (err) {
    error("Failed to load persisted social graph, using bundled graph instead:", err)
    instance = await loadPreCrawledGraph(publicKey)
  } finally {
    notifyGraphChange()
  }
}

const saveToLocalForage = async () => {
  if (!isInitialized) {
    return
  }

  try {
    const serialized = await instance.toBinary()
    await localForage.setItem("socialGraph", serialized)
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

  instance.handleEvent(evs)
  throttledSave()

  if (hasMuteListUpdate) {
    throttledMuteListUpdate()
  }

  // Notify subscribers of follow list changes
  if (hasFollowListUpdate) {
    notifyGraphChange()
  }
}

let sub: NDKSubscription | undefined
let isManualRecrawling = false
let graphSyncGeneration = 0
let unsubscribeFromUserStore: (() => void) | undefined
let activeGraphSync: {publicKey: string; promise: Promise<void>} | undefined
const activeOpinionSubscriptions = new Set<NDKSubscription>()

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

    const {ndk: getNdk, initNDK} = await import("@/utils/ndk")
    if (!isCurrent()) return
    initNDK() // Init in background - messages queue until ready
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
      instance.setRoot(DEFAULT_SOCIAL_GRAPH_ROOT)
    }
    resolveLoaded?.(true)
  }
}

// Setup subscription (called after NDK is ready)
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
  await instance.recalculateFollowDistances()
  if (syncGeneration !== graphSyncGeneration || useUserStore.getState().publicKey) {
    return
  }

  notifyGraphChange()
  useSocialGraphStore.getState().incrementMuteListVersion()
  useSocialGraphStore.getState().setReady(true)
}

const waitForInitialSubscription = (
  subscription: NDKSubscription,
  isCurrent: () => boolean,
  deadline: number
) =>
  new Promise<void>((resolve) => {
    let settled = false
    let eoseReceived = false
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    const cutoffTimer = setTimeout(finish, Math.max(0, deadline - Date.now()))

    function finish() {
      if (settled) return
      settled = true
      if (settleTimer) clearTimeout(settleTimer)
      clearTimeout(cutoffTimer)
      resolve()
    }
    const scheduleSettledFinish = () => {
      if (settled || !eoseReceived || !isCurrent()) return
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(
        finish,
        Math.min(INITIAL_SYNC_SETTLE_MS, Math.max(0, deadline - Date.now()))
      )
    }
    subscription.on("event", scheduleSettledFinish)
    subscription.on("close", finish)
    subscription.on("eose", () => {
      eoseReceived = true
      scheduleSettledFinish()
    })
  })

async function setupSubscription(publicKey: string) {
  const syncGeneration = ++graphSyncGeneration
  useSocialGraphStore.getState().setReady(false)
  stopGraphSyncSubscriptions()

  await instance.setRoot(publicKey)
  await instance.recalculateFollowDistances()
  if (!isCurrentGraphSync(syncGeneration, publicKey)) return
  notifyGraphChange()

  // Import ndk lazily to avoid initialization race
  const {ndk: getNdk, initNDK} = await import("@/utils/ndk")
  await initNDK()
  if (!isCurrentGraphSync(syncGeneration, publicKey)) return

  const rootFilters = [
    {kinds: [KIND_CONTACTS], authors: [publicKey], limit: 1},
    {kinds: [KIND_MUTE_LIST], authors: [publicKey], limit: 1},
  ]
  const initialSyncDeadline = Date.now() + INITIAL_SYNC_TIMEOUT_MS
  const rootSub = getNdk().subscribe(rootFilters, {
    // Keep cache and relay events in one ordered worker stream. Readiness uses
    // its EOSE when available, with one global bounded snapshot cutoff below.
    transports: ["worker-transport"],
    waitForCacheBeforeRelays: true,
  })
  if (!isCurrentGraphSync(syncGeneration, publicKey)) {
    rootSub.stop()
    return
  }
  sub = rootSub

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
    handleSocialGraphEvent(ev as NostrEvent)
    void instance.recalculateFollowDistances().then(() => {
      if (isCurrentGraphSync(syncGeneration, publicKey)) notifyGraphChange()
    })

    if (initialSyncDone) {
      queueMicrotask(() =>
        getMissingFollowLists(publicKey, () =>
          isCurrentGraphSync(syncGeneration, publicKey)
        )
      )
    }
  }
  rootSub.on("event", handleRootEvent)

  const hydrateDirectFollowOpinions = async () => {
    if (!isCurrentGraphSync(syncGeneration, publicKey)) return
    const hydratedAuthors = new Set<string>()

    // Root contact data can arrive while the first opinion batch is loading.
    // Continue until every direct follow in the settled root snapshot was read.
    while (
      isCurrentGraphSync(syncGeneration, publicKey) &&
      Date.now() < initialSyncDeadline
    ) {
      const authors = Array.from(instance.getFollowedByUser(publicKey)).filter(
        (author) => !hydratedAuthors.has(author)
      )
      if (authors.length === 0) break

      for (let index = 0; index < authors.length; index += 500) {
        if (
          !isCurrentGraphSync(syncGeneration, publicKey) ||
          Date.now() >= initialSyncDeadline
        ) {
          break
        }
        const authorsBatch = authors.slice(index, index + 500)
        const opinionSub = getNdk().subscribe(
          {
            kinds: [KIND_CONTACTS, KIND_MUTE_LIST],
            authors: authorsBatch,
          },
          {
            transports: ["worker-transport"],
            waitForCacheBeforeRelays: true,
          }
        )
        activeOpinionSubscriptions.add(opinionSub)

        opinionSub.on("event", (event) => {
          if (!isCurrentGraphSync(syncGeneration, publicKey)) return
          handleSocialGraphEvent(event as NostrEvent)
        })
        await waitForInitialSubscription(
          opinionSub,
          () => isCurrentGraphSync(syncGeneration, publicKey),
          initialSyncDeadline
        )
        activeOpinionSubscriptions.delete(opinionSub)
        opinionSub.stop()
        authorsBatch.forEach((author) => hydratedAuthors.add(author))
      }

      await instance.recalculateFollowDistances()
    }
    if (!isCurrentGraphSync(syncGeneration, publicKey)) return
    notifyGraphChange()
    // Ensure visibility caches observe the complete initial opinion snapshot,
    // even when many mute events arrived inside the throttling window.
    useSocialGraphStore.getState().incrementMuteListVersion()
  }

  await waitForInitialSubscription(
    rootSub,
    () => isCurrentGraphSync(syncGeneration, publicKey),
    initialSyncDeadline
  )
  if (!isCurrentGraphSync(syncGeneration, publicKey)) return

  await hydrateDirectFollowOpinions()
  if (!isCurrentGraphSync(syncGeneration, publicKey)) return

  // Freeze the hydration phase before publishing readiness. Everything after
  // this point is eventual background sync for future feed mounts.
  rootSub.stop()
  if (sub === rootSub) sub = undefined
  if (!isCurrentGraphSync(syncGeneration, publicKey)) return

  initialSyncDone = true

  const backgroundRootSub = getNdk().subscribe(rootFilters, {
    transports: ["worker-transport"],
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
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
        cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
      }
    )
    backgroundOpinionSub.on("event", (event) => {
      if (!isCurrentGraphSync(syncGeneration, publicKey)) return
      handleSocialGraphEvent(event as NostrEvent)
      void instance.recalculateFollowDistances().then(() => {
        if (isCurrentGraphSync(syncGeneration, publicKey)) notifyGraphChange()
      })
    })
    if (!isCurrentGraphSync(syncGeneration, publicKey)) {
      backgroundOpinionSub.stop()
      return
    }
    activeOpinionSubscriptions.add(backgroundOpinionSub)
  }

  if (!isCurrentGraphSync(syncGeneration, publicKey)) return
  useSocialGraphStore.getState().setReady(true)
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
              instance.merge(newInstance)
            } else {
              instance = newInstance
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
  instance = new SocialGraph(instance.getRoot())
  notifyGraphChange()
  await saveToLocalForage()
  log("Cleared social graph")
}

export const resetGraph = async () => {
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
