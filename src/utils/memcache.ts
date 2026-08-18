import {NDKEvent} from "@/lib/ndk"
import {LRUCache} from "typescript-lru-cache"
import throttle from "lodash/throttle"
import Dexie, {type EntityTable} from "dexie"
import {FeedType} from "@/stores/feed"

// Dexie database for seen events
class SeenEventsDb extends Dexie {
  public seenEvents!: EntityTable<{id: string}, "id">
  constructor() {
    super("SeenEvents")
    this.version(1).stores({
      seenEvents: "id",
    })
  }
}

const seenDb = new SeenEventsDb()

// Buffer for batching deletes - Dexie doesn't auto-batch separate delete() calls
const evictedKeys: string[] = []

const flushDeletes = () => {
  if (evictedKeys.length === 0) return
  const toDelete = evictedKeys.splice(0)
  seenDb.seenEvents.bulkDelete(toDelete).catch(() => {})
}

const throttledFlushDeletes = throttle(flushDeletes, 1000, {
  leading: false,
  trailing: true,
})

// LRU cache with batched eviction deletes
export const seenEventIds = new LRUCache<string, boolean>({
  maxSize: 10000,
  onEntryEvicted: ({key}) => {
    evictedKeys.push(key)
    throttledFlushDeletes()
  },
})

// Cache for NIP-05 verification results
export const nip05VerificationCache = new LRUCache<string, boolean>({maxSize: 1000})

// Cache for imgproxy failures - track URLs that failed to load through proxy
export const imgproxyFailureCache = new LRUCache<string, boolean>({maxSize: 100})

// Cache for loaded images to prevent remounting and flashing
export const loadedImageCache = new LRUCache<string, string>({maxSize: 200})

// Special feed cache interfaces

interface ReactionSubscriptionCache {
  authorScope?: string
  hasInitialData?: boolean
  pendingReactionCounts?: Map<string, Set<string>>
  showingReactionCounts?: Map<string, Set<string>>
}

interface ChronologicalSubscriptionCache {
  authorScope?: string
  hasInitialData?: boolean
  pendingPosts?: Map<string, number>
  showingPosts?: Map<string, number>
}

interface CombinedPostFetcherCache {
  scopeKey?: string
  events?: NDKEvent[]
  hasLoadedInitial?: boolean
}

interface AlgorithmicFeedCache {
  combinedPostFetcher: CombinedPostFetcherCache
  reactionSubscription: ReactionSubscriptionCache
  chronologicalSubscription: ChronologicalSubscriptionCache
}

export const feedCaches: Partial<Record<FeedType, AlgorithmicFeedCache>> = {}

export const getOrCreateAlgorithmicFeedCache = (feedId: FeedType) => {
  if (!feedCaches[feedId]) {
    feedCaches[feedId] = {
      combinedPostFetcher: {},
      reactionSubscription: {},
      chronologicalSubscription: {},
    }
  }
  return feedCaches[feedId]
}

// Load seenEventIds from Dexie on startup using streaming iterator
seenDb.seenEvents
  .each(({id}) => {
    seenEventIds.set(id, true)
  })
  .catch((e) => {
    console.error("failed to load seenEventIds:", e)
  })

// Batch buffer for pending writes
const pendingSeenIds = new Set<string>()

const throttledSave = throttle(
  async () => {
    if (pendingSeenIds.size === 0) return

    const toSave: {id: string}[] = []
    for (const id of pendingSeenIds) {
      toSave.push({id})
    }
    pendingSeenIds.clear()

    try {
      await seenDb.seenEvents.bulkPut(toSave)
    } catch (e) {
      console.error("failed to save seenEventIds:", e)
    }
  },
  10000,
  {leading: false, trailing: true}
)

export const addSeenEventId = (id: string) => {
  seenEventIds.set(id, true)
  pendingSeenIds.add(id)
  throttledSave()
}

export const clearAlgorithmicFeedCaches = () => {
  // Clear all algorithmic feed caches but keep pending lists to refresh fast
  Object.keys(feedCaches).forEach((key) => {
    const cache = feedCaches[key as FeedType]
    if (cache) {
      cache.combinedPostFetcher.events = []
      cache.combinedPostFetcher.hasLoadedInitial = false
      cache.combinedPostFetcher.scopeKey = undefined
      cache.reactionSubscription.authorScope = undefined
      cache.reactionSubscription.hasInitialData = false
      cache.reactionSubscription.pendingReactionCounts?.clear()
      cache.reactionSubscription.showingReactionCounts?.clear()
      cache.chronologicalSubscription.hasInitialData = false
      cache.chronologicalSubscription.authorScope = undefined
      cache.chronologicalSubscription.pendingPosts?.clear()
      cache.chronologicalSubscription.showingPosts?.clear()
      console.warn(`Cleared algorithmic feed cache for ${key}`, cache)
    }
  })
}
