import useReactionSubscription from "./useReactionSubscription"
import useChronologicalSubscription from "./useChronologicalSubscription"
import useCombinedPostFetcher from "./useCombinedPostFetcher"
import usePopularityFilters from "./usePopularityFilters"
import {NDKEvent} from "@nostr-dev-kit/ndk"

interface PostFetcherCache {
  events?: NDKEvent[]
  hasLoadedInitial?: boolean
}

interface CombinedPostFetcherCache {
  events?: NDKEvent[]
  hasLoadedInitial?: boolean
}

interface ReactionSubscriptionCache {
  pendingReactionCounts?: Map<string, Set<string>>
  showingReactionCounts?: Map<string, Set<string>>
}

interface ChronologicalSubscriptionCache {
  pendingPosts?: Map<string, number>
  showingPosts?: Map<string, number>
  timeRange?: number
}

interface PopularityFiltersCache {
  filterLevel?: number
}

interface FeedCache {
  postFetcher?: PostFetcherCache
  combinedPostFetcher?: CombinedPostFetcherCache
  reactionSubscription: ReactionSubscriptionCache
  chronologicalSubscription?: ChronologicalSubscriptionCache
  popularityFilters: PopularityFiltersCache
}

interface FeedConfig {
  filterSeen?: boolean
  showReplies?: boolean
  popularRatio?: number
}

export default function useAlgorithmicFeed(cache: FeedCache, config: FeedConfig = {}) {
  const {showReplies = false, filterSeen = false, popularRatio = 0.5} = config

  const {currentFilters, expandFilters} = usePopularityFilters(cache.popularityFilters)

  const {getNextMostPopular} = useReactionSubscription(
    currentFilters,
    expandFilters,
    cache.reactionSubscription,
    filterSeen
  )

  const {getNextChronological} = useChronologicalSubscription(
    cache.chronologicalSubscription || {},
    filterSeen,
    showReplies
  )

  const result = useCombinedPostFetcher({
    getNextPopular: getNextMostPopular,
    getNextChronological,
    cache: cache.combinedPostFetcher || {},
    popularRatio,
  })

  const getPopularPendingCount = () => {
    return cache.reactionSubscription.pendingReactionCounts?.size || 0
  }

  const getChronologicalPendingCount = () => {
    return cache.chronologicalSubscription?.pendingPosts?.size || 0
  }

  const isStuck =
    result.events.length === 0 &&
    !result.loading &&
    (getPopularPendingCount() > 0 || getChronologicalPendingCount() > 0)

  return {...result, isStuck}
}
