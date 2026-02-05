import {SocialGraph, NostrEvent} from "nostr-social-graph/src"
import {NDKSubscription} from "@/lib/ndk"
import {useUserStore} from "@/stores/user"
import {useSocialGraphStore} from "@/stores/socialGraph"
import {VerifiedEvent} from "nostr-tools"
import debounce from "lodash/debounce"
import throttle from "lodash/throttle"
import localForage from "localforage"
// Removed static import to avoid race condition - use dynamic import in setupSubscription
import {useEffect, useState, useCallback} from "react"
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

  const loadGraph = async () => {
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
    notifyGraphChange()
  }

  return loadGraph()
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

function getFollowListsInternal(
  myPubKey: string,
  missingOnly = true,
  upToDistance = 1,
  isManual = false
) {
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
    if (isManual && !isManualRecrawling) return

    const {ndk: getNdk, initNDK} = await import("@/utils/ndk")
    initNDK() // Init in background - messages queue until ready
    const sub = getNdk().subscribe(
      {
        kinds: [KIND_CONTACTS, KIND_MUTE_LIST],
        authors: authors,
      },
      {closeOnEose: true}
    )

    sub.on("event", (e: unknown) => {
      handleSocialGraphEvent(e as unknown as VerifiedEvent)
      debouncedRemoveNonFollowed()
    })
  }

  const processBatch = () => {
    if (isManual && !isManualRecrawling) {
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

function getMissingFollowLists(myPubKey: string) {
  getFollowListsInternal(myPubKey, true, 1)
}

let isLoaded = false
let resolveLoaded: ((value: boolean) => void) | null = null

export const socialGraphLoaded = new Promise<boolean>((resolve) => {
  resolveLoaded = resolve
})

// Initialize social graph (separate from subscription setup)
export const initializeSocialGraph = async () => {
  const currentPublicKey = useUserStore.getState().publicKey
  await initializeInstance(currentPublicKey || undefined)

  if (!currentPublicKey) {
    instance.setRoot(DEFAULT_SOCIAL_GRAPH_ROOT)
  }

  isLoaded = true
  resolveLoaded?.(true)
}

// Setup subscription (called after NDK is ready)
export const setupSocialGraphSubscriptions = async () => {
  const currentPublicKey = useUserStore.getState().publicKey
  if (currentPublicKey) {
    await setupSubscription(currentPublicKey)
  }

  useUserStore.subscribe((state, prevState) => {
    if (state.publicKey !== prevState.publicKey) {
      if (state.publicKey) {
        setupSubscription(state.publicKey)
      } else {
        instance.setRoot(DEFAULT_SOCIAL_GRAPH_ROOT)
      }
    }
  })
}

// Auto-initialize on module load
initializeSocialGraph().catch((err) => {
  error("Failed to initialize social graph:", err)
})

export const useSocialGraphLoaded = () => {
  const [isSocialGraphLoaded, setIsSocialGraphLoaded] = useState(isLoaded)
  useEffect(() => {
    socialGraphLoaded.then(() => {
      setIsSocialGraphLoaded(true)
    })
  }, [])
  return isSocialGraphLoaded
}

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
  const follows = useCallback(() => {
    if (!pubKey) return []
    const followSet = instance.getFollowedByUser(pubKey, includeSelf)
    return Array.from(followSet)
  }, [pubKey, includeSelf, version])

  return follows()
}

/**
 * Hook that returns the follow distance for a user.
 * Re-renders when the social graph changes.
 */
export const useFollowDistance = (pubKey: string | null | undefined): number => {
  // Subscribe to graph version changes via Zustand store
  useSocialGraphStore((state) => state.version)

  if (!pubKey) return 1000
  return instance.getFollowDistance(pubKey)
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
  return instance.size()
}

async function setupSubscription(publicKey: string) {
  instance.setRoot(publicKey)
  await instance.recalculateFollowDistances()
  notifyGraphChange()
  sub?.stop()

  // Import ndk lazily to avoid initialization race
  const {ndk: getNdk, initNDK} = await import("@/utils/ndk")
  initNDK() // Init in background - messages queue until ready
  sub = getNdk().subscribe({
    kinds: [KIND_CONTACTS, KIND_MUTE_LIST],
    authors: [publicKey],
    limit: 1,
  })
  let latestTime = 0
  sub?.on("event", (ev) => {
    if (ev.kind === KIND_MUTE_LIST) {
      handleSocialGraphEvent(ev as NostrEvent)
      return
    }
    if (typeof ev.created_at !== "number" || ev.created_at < latestTime) {
      return
    }
    latestTime = ev.created_at
    handleSocialGraphEvent(ev as NostrEvent)
    queueMicrotask(() => getMissingFollowLists(publicKey))
    instance.recalculateFollowDistances().then(() => notifyGraphChange())
  })
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

export function getMutualFollows(pubkey?: string): string[] {
  const myPubkey = pubkey || instance.getRoot()
  if (!myPubkey) return []

  const following = Array.from(instance.getFollowedByUser(myPubkey))
  return following.filter((followedPubkey) =>
    instance.getFollowedByUser(followedPubkey).has(myPubkey)
  )
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

export default getSocialGraph
