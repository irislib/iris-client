import useReactionSubscription from "./useReactionSubscription"
import useChronologicalSubscription from "./useChronologicalSubscription"
import useCombinedPostFetcher from "./useCombinedPostFetcher"
import usePopularityFilters from "./usePopularityFilters"
import {NDKEvent} from "@/lib/ndk"

interface CombinedPostFetcherCache {
  scopeKey?: string
  events?: NDKEvent[]
  hasLoadedInitial?: boolean
}

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

interface FeedCache {
  combinedPostFetcher?: CombinedPostFetcherCache
  reactionSubscription: ReactionSubscriptionCache
  chronologicalSubscription?: ChronologicalSubscriptionCache
}

interface FeedConfig {
  filterSeen?: boolean
  showReplies?: boolean
  popularRatio?: number
  excludeOwnPosts?: boolean
}

export default function useAlgorithmicFeed(cache: FeedCache, config: FeedConfig = {}) {
  const {
    showReplies = false,
    filterSeen = false,
    popularRatio = 0.5,
    excludeOwnPosts = false,
  } = config

  const {currentFilters, chronologicalAuthors, visibilitySnapshot, expandFilters} =
    usePopularityFilters(filterSeen)

  const {
    getNextMostPopular,
    hasInitialData: hasPopularData,
    sourceKey,
  } = useReactionSubscription(
    currentFilters,
    expandFilters,
    cache.reactionSubscription,
    visibilitySnapshot,
    filterSeen
  )

  const {
    getNextChronological,
    hasInitialData: hasChronologicalData,
    sourceKey: chronologicalSourceKey,
  } = useChronologicalSubscription(
    cache.chronologicalSubscription || {},
    filterSeen,
    showReplies,
    excludeOwnPosts,
    currentFilters.ready,
    chronologicalAuthors,
    currentFilters.scopeKey
  )

  const result = useCombinedPostFetcher({
    getNextPopular: getNextMostPopular,
    getNextChronological,
    hasPopularData,
    hasChronologicalData,
    cache: cache.combinedPostFetcher || {},
    sourceKey: `${sourceKey}|${chronologicalSourceKey}`,
    ready: currentFilters.ready,
    visibilitySnapshot,
    popularRatio,
    excludeOwnPosts,
  })

  return result
}
