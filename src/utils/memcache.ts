import {NDKEvent} from "@nostr-dev-kit/ndk"
import {SortedMap} from "./SortedMap/SortedMap"
import {LRUCache} from "typescript-lru-cache"
import throttle from "lodash/throttle"
import localforage from "localforage"
import {FeedType} from "@/stores/feed"

export const eventsByIdCache = new LRUCache({maxSize: 500})
export const feedCache = new LRUCache<string, SortedMap<string, NDKEvent>>({maxSize: 10})
export const replyFeedCache = new LRUCache<string, SortedMap<string, NDKEvent>>({
  maxSize: 20,
})
export const seenEventIds = new LRUCache<string, boolean>({maxSize: 10000})

// Cache for NIP-05 verification results
export const nip05VerificationCache = new LRUCache<string, boolean>({maxSize: 1000})

// Cache for imgproxy failures - track URLs that failed to load through proxy
export const imgproxyFailureCache = new LRUCache<string, boolean>({maxSize: 100})

// Cache for loaded images to prevent remounting and flashing
export const loadedImageCache = new LRUCache<string, string>({maxSize: 200})

// Special feed cache interfaces

interface ReactionSubscriptionCache {
  pendingReactionCounts?: Map<string, Set<string>>
  showingReactionCounts?: Map<string, Set<string>>
}

interface PopularityFiltersCache {
  filterLevel?: number
}

interface ChronologicalSubscriptionCache {
  pendingPosts?: Map<string, number>
  showingPosts?: Map<string, number>
  timeRange?: number
}

interface CombinedPostFetcherCache {
  events?: NDKEvent[]
}

interface PostFetcherCache {
  events?: NDKEvent[]
}

interface PopularHomeFeedCache {
  postFetcher: PostFetcherCache
  reactionSubscription: ReactionSubscriptionCache
  popularityFilters: PopularityFiltersCache
  chronologicalSubscription?: ChronologicalSubscriptionCache
}

interface ForYouFeedCache {
  combinedPostFetcher: CombinedPostFetcherCache
  reactionSubscription: ReactionSubscriptionCache
  chronologicalSubscription: ChronologicalSubscriptionCache
  popularityFilters: PopularityFiltersCache
}

// Simple cache for popular home feed - no LRU needed since there's only one instance
export const popularHomeFeedCache: PopularHomeFeedCache = {
  postFetcher: {},
  reactionSubscription: {},
  popularityFilters: {},
  chronologicalSubscription: {},
}

// Cache for for-you feed
export const forYouFeedCache: ForYouFeedCache = {
  combinedPostFetcher: {},
  reactionSubscription: {},
  chronologicalSubscription: {},
  popularityFilters: {},
}

export const getOrCreateAlgorithmicFeedCache = (feedId: FeedType) => {
  if (feedId === "popular") {
    return popularHomeFeedCache
  } else if (feedId === "for-you") {
    return forYouFeedCache
  } else {
    throw new Error(`Unknown feed type: ${feedId}`)
  }
}

// Load seenEventIds from localForage
localforage
  .getItem<string[]>("seenEventIds")
  .then((s) => {
    if (s) {
      s.forEach((id) => seenEventIds.set(id, true))
    }
  })
  .catch((e) => {
    console.error("failed to load seenEventIds:", e)
  })

const throttledSave = throttle(
  () => localforage.setItem("seenEventIds", [...seenEventIds.keys()]),
  5000
)

export const addSeenEventId = (id: string) => {
  seenEventIds.set(id, true)
  throttledSave()
}

export const clearAlgorithmicFeedCaches = () => {
  // Clear popular feed cache
  popularHomeFeedCache.postFetcher = {}
  popularHomeFeedCache.reactionSubscription = {}
  popularHomeFeedCache.popularityFilters = {}
  popularHomeFeedCache.chronologicalSubscription = {}

  // Clear for-you feed cache
  forYouFeedCache.combinedPostFetcher = {}
  forYouFeedCache.reactionSubscription = {}
  forYouFeedCache.chronologicalSubscription = {}
  forYouFeedCache.popularityFilters = {}
}
