import {SocialGraph, NostrEvent, SerializedSocialGraph} from "nostr-social-graph"
import {NDKSubscription} from "@nostr-dev-kit/ndk"
import {useUserStore} from "@/stores/user"
import {VerifiedEvent} from "nostr-tools"
import debounce from "lodash/debounce"
import throttle from "lodash/throttle"
import localForage from "localforage"
import {ndk} from "@/utils/ndk"

const DEFAULT_SOCIAL_GRAPH_ROOT =
  "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0"

let instance = new SocialGraph(DEFAULT_SOCIAL_GRAPH_ROOT)
let isInitialized = false

async function initializeInstance(publicKey?: string) {
  if (isInitialized) {
    console.log("setting root", publicKey)
    instance.setRoot(publicKey ?? DEFAULT_SOCIAL_GRAPH_ROOT)
    return
  }
  isInitialized = true
  const data = await localForage.getItem("socialGraph")
  if (data && typeof data === "object") {
    try {
      instance = new SocialGraph(
        publicKey ?? DEFAULT_SOCIAL_GRAPH_ROOT,
        data as SerializedSocialGraph
      )
    } catch (e) {
      console.error("error deserializing", e)
      await localForage.removeItem("socialGraph")
      const {default: preCrawledGraph} = await import(
        "nostr-social-graph/data/socialGraph.json"
      )
      instance = new SocialGraph(
        publicKey ?? DEFAULT_SOCIAL_GRAPH_ROOT,
        preCrawledGraph as unknown as SerializedSocialGraph
      )
    }
  } else {
    console.log("no social graph found")
    await localForage.removeItem("socialGraph")
    const {default: preCrawledGraph} = await import(
      "nostr-social-graph/data/socialGraph.json"
    )
    instance = new SocialGraph(
      publicKey ?? DEFAULT_SOCIAL_GRAPH_ROOT,
      preCrawledGraph as unknown as SerializedSocialGraph
    )
  }
}

const MAX_SOCIAL_GRAPH_SERIALIZE_SIZE = 1000000
const throttledSave = throttle(async () => {
  try {
    const serialized = instance.serialize(MAX_SOCIAL_GRAPH_SERIALIZE_SIZE)
    await localForage.setItem("socialGraph", serialized)
    console.log("Saved social graph of size", instance.size())
  } catch (e) {
    console.error("failed to serialize SocialGraph or UniqueIds", e)
    console.log("social graph size", instance.size())
  }
}, 10000)

const debouncedRemoveNonFollowed = debounce(() => {
  const removedCount = instance.removeMutedNotFollowedUsers()
  console.log("Removing", removedCount, "muted users not followed by anyone")
  throttledSave()
}, 11000)

export const handleSocialGraphEvent = (evs: NostrEvent | Array<NostrEvent>) => {
  instance.handleEvent(evs)
  throttledSave()
}

let sub: NDKSubscription | undefined

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

  const fetchBatch = (authors: string[]) => {
    const sub = ndk().subscribe(
      {
        kinds: [3, 10000],
        authors: authors,
      },
      {closeOnEose: true}
    )
    sub.on("event", (e) => {
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

const throttledRecalculate = throttle(
  () => {
    instance.recalculateFollowDistances()
  },
  10000,
  {leading: true}
)

export const socialGraphLoaded = new Promise((resolve) => {
  const currentPublicKey = useUserStore.getState().publicKey
  initializeInstance(currentPublicKey).then(() => {
    resolve(true)

    if (currentPublicKey) {
      setupSubscription(currentPublicKey)
    } else {
      instance.setRoot(DEFAULT_SOCIAL_GRAPH_ROOT)
    }
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

function setupSubscription(publicKey: string) {
  sub?.stop()
  sub = ndk().subscribe({
    kinds: [3, 10000],
    authors: [publicKey],
    limit: 1,
  })
  let latestTime = 0
  sub?.on("event", (ev) => {
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
    throttledRecalculate()
  })
}

export const saveToFile = () => {
  const data = instance.serialize()
  const url = URL.createObjectURL(
    new File([JSON.stringify(data)], "social_graph.json", {
      type: "text/json",
    })
  )
  const a = document.createElement("a")
  a.href = url
  a.download = "social_graph.json"
  a.click()
}

export const loadFromFile = (merge = false) => {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = ".json"
  input.multiple = false
  input.onchange = () => {
    if (input.files?.length) {
      const file = input.files[0]
      file.text().then((json) => {
        try {
          const data = JSON.parse(json)
          if (merge) {
            instance.merge(new SocialGraph(instance.getRoot(), data))
          } else {
            instance = new SocialGraph(instance.getRoot(), data)
          }
        } catch (e) {
          console.error("failed to load social graph from file:", e)
        }
      })
    }
  }
  input.click()
}

export const downloadLargeGraph = (maxBytes: number) => {
  fetch("https://graph-api.iris.to/social-graph?maxBytes=" + maxBytes)
    .then((response) => response.json())
    .then((data) => {
      instance = new SocialGraph(instance.getRoot(), data)
      throttledSave()
    })
    .catch((error) => {
      console.error("failed to load large social graph:", error)
    })
}

export const loadAndMerge = () => loadFromFile(true)

export default () => instance
