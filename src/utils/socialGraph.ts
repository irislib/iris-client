import {SocialGraph} from "nostr-social-graph/src"
import {NostrEvent} from "nostr-tools"
import {useUserStore} from "@/stores/user"
import {VerifiedEvent} from "nostr-tools"
import debounce from "lodash/debounce"
import throttle from "lodash/throttle"
import localForage from "localforage"

import {useEffect, useState} from "react"

export const DEFAULT_SOCIAL_GRAPH_ROOT =
  "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0"

let instance = new SocialGraph(DEFAULT_SOCIAL_GRAPH_ROOT)
let isInitialized = false

async function loadPreCrawledGraph(publicKey: string): Promise<SocialGraph> {
  const binaryUrl = (await import("nostr-social-graph/data/socialGraph.bin?url")).default
  const response = await fetch(binaryUrl)
  const binaryData = new Uint8Array(await response.arrayBuffer())
  const graph = await SocialGraph.fromBinary(publicKey, binaryData)
  console.log("loaded default binary social graph of size", graph.size())
  return graph
}

async function initializeInstance(publicKey = DEFAULT_SOCIAL_GRAPH_ROOT) {
  if (isInitialized) {
    console.log("setting root", publicKey)
    instance.setRoot(publicKey)
    return
  }
  console.log("root", publicKey, publicKey.length)
  isInitialized = true
  const data = await localForage.getItem("socialGraph")
  if (data) {
    try {
      instance = await SocialGraph.fromBinary(publicKey, data as Uint8Array)
      console.log("loaded local social graph of size", instance.size())
    } catch (e) {
      console.error("error deserializing", e)
      await localForage.removeItem("socialGraph")
      instance = await loadPreCrawledGraph(publicKey)
    }
  } else {
    console.log("no social graph found")
    await localForage.removeItem("socialGraph")
    instance = await loadPreCrawledGraph(publicKey)
  }
}

const saveToLocalForage = async () => {
  try {
    const serialized = await instance.toBinary()
    await localForage.setItem("socialGraph", serialized)
    console.log("Saved social graph of size", instance.size())
  } catch (e) {
    console.error("failed to serialize SocialGraph or UniqueIds", e)
    console.log("social graph size", instance.size())
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

export const handleSocialGraphEvent = (evs: NostrEvent | Array<NostrEvent>) => {
  instance.handleEvent(evs)
  throttledSave()
}

let sub: any | undefined

export function getFollowLists(myPubKey: string, missingOnly = true, upToDistance = 1) {
  const toFetch = new Set<string>()

  // Function to add users to toFetch set
  const addUsersToFetch = (users: Set<string>, currentDistance: number) => {
    for (const user of users) {
      if (!missingOnly || instance.getFollowedByUser(user).size === 0) {
        toFetch.add(user)
      }
    }

    // If we haven't reached the upToDistance, continue to the next level
    if (currentDistance < upToDistance) {
      for (const user of users) {
        const nextLevelUsers = instance.getFollowedByUser(user)
        addUsersToFetch(nextLevelUsers, currentDistance + 1)
      }
    }
  }

  // Start with the user's direct follows
  const myFollows = instance.getFollowedByUser(myPubKey)
  addUsersToFetch(myFollows, 1)

  console.log("fetching", toFetch.size, missingOnly ? "missing" : "total", "follow lists")

  const fetchBatch = (_authors: string[]) => {
    const sub = {on: (_event: string, _callback: any) => {}, stop: () => {}}
    // Temporarily disabled subscription
    sub.on("event", (e: any) => {
      handleSocialGraphEvent(e as unknown as VerifiedEvent)
      debouncedRemoveNonFollowed()
    })
  }

  const processBatch = () => {
    const batch = [...toFetch].slice(0, 500)
    if (batch.length > 0) {
      fetchBatch(batch)
      batch.forEach((author) => toFetch.delete(author))
      if (toFetch.size > 0) {
        setTimeout(processBatch, 5000)
      }
    }
  }

  processBatch()
}

function getMissingFollowLists(myPubKey: string) {
  getFollowLists(myPubKey, true)
}

let isLoaded = false

export const socialGraphLoaded = new Promise((resolve) => {
  const currentPublicKey = useUserStore.getState().publicKey
  initializeInstance(currentPublicKey || undefined).then(() => {
    if (currentPublicKey) {
      setupSubscription(currentPublicKey)
    } else {
      instance.setRoot(DEFAULT_SOCIAL_GRAPH_ROOT)
    }
    isLoaded = true
    resolve(true)
  })

  useUserStore.subscribe((state, prevState) => {
    if (state.publicKey !== prevState.publicKey) {
      if (state.publicKey) {
        setupSubscription(state.publicKey)
      } else {
        instance.setRoot(DEFAULT_SOCIAL_GRAPH_ROOT)
      }
    }
  })
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

async function setupSubscription(publicKey: string) {
  instance.setRoot(publicKey)
  await instance.recalculateFollowDistances()
  sub?.stop()
  sub = {on: () => {}, stop: () => {}}
  // Temporarily disabled: ndk().subscribe({ kinds: [3, 10000], authors: [publicKey], limit: 1 })
  let latestTime = 0
  sub?.on("event", (ev: any) => {
    if (ev.kind === 10000) {
      handleSocialGraphEvent(ev as NostrEvent)
      return
    }
    if (typeof ev.created_at !== "number" || ev.created_at < latestTime) {
      return
    }
    latestTime = ev.created_at
    handleSocialGraphEvent(ev as NostrEvent)
    queueMicrotask(() => getMissingFollowLists(publicKey))
    instance.recalculateFollowDistances()
  })
}

export const saveToFile = async () => {
  const data = await instance.toBinary()
  const url = URL.createObjectURL(
    new File([data], "social_graph.bin", {
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
            await saveToLocalForage()
          })
        } catch (e) {
          console.error("failed to load social graph from file:", e)
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
      throttledSave()

      // Re-query our own follow list
      setupSubscription(instance.getRoot())
      const root = instance.getRoot()
      if (root && root !== DEFAULT_SOCIAL_GRAPH_ROOT) {
        getFollowLists(root, false, 1)
      }
    })
    .catch((error) => {
      console.error("failed to load large social graph:", error)
    })
}

export const loadAndMerge = () => loadFromFile(true)

export const clearGraph = async () => {
  instance = new SocialGraph(instance.getRoot())
  await saveToLocalForage()
  console.log("Cleared social graph")
}

export const resetGraph = async () => {
  const root = instance.getRoot()
  instance = await loadPreCrawledGraph(root)
  await saveToLocalForage()
  console.log("Reset social graph to default")
}

export default () => instance
