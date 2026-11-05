import useReactionSubscription from "./useReactionSubscription"
import useChronologicalSubscription from "./useChronologicalSubscription"
import useCombinedPostFetcher from "./useCombinedPostFetcher"
import usePopularityFilters from "./usePopularityFilters"
import useSparseDiscovery, {type SparseDiscoveryCache} from "./useSparseDiscovery"
import {AppEvent} from "@/lib/nostr"
import {useUserStore} from "@/stores/user"
import {useFeedStore} from "@/stores/feed"

interface CombinedPostFetcherCache {
  scopeKey?: string
  events?: AppEvent[]
  hasLoadedInitial?: boolean
  completedInitialSources?: number
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
  pendingPosts?: Map<string, AppEvent>
  showingPosts?: Map<string, AppEvent>
}

interface FeedCache {
  combinedPostFetcher?: CombinedPostFetcherCache
  reactionSubscription: ReactionSubscriptionCache
  chronologicalSubscription?: ChronologicalSubscriptionCache
  sparseDiscovery?: SparseDiscoveryCache
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

  const {
    currentFilters,
    chronologicalAuthors,
    discoveryAuthors,
    visibilitySnapshot,
    expandFilters,
  } = usePopularityFilters(filterSeen)
  const chronologicalEnabled = popularRatio < 1
  const myPubKey = useUserStore((state) => state.publicKey)
  const refreshSignal = useFeedStore((state) => state.feedRefreshSignal)
  cache.sparseDiscovery ||= {}
  const discovery = useSparseDiscovery(
    cache.sparseDiscovery,
    discoveryAuthors,
    `${currentFilters.scopeKey}:refresh=${refreshSignal}`,
    currentFilters.ready && filterSeen
  )
  // Small networks favor rotation but may run out of other active authors.
  // Count eligible follows, not this batch: a slow relay must not turn a large
  // network into a single-author feed. Discovery uses its default network here.
  const eligibleAuthorCount = currentFilters.authors.filter(
    (author) =>
      (!excludeOwnPosts || author !== myPubKey) &&
      !visibilitySnapshot?.shouldHideRecommendationUser(author)
  ).length

  const {
    getNextMostPopular,
    hasInitialData: hasPopularData,
    sourceKey,
    revision: popularRevision,
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
    revision: chronologicalRevision,
  } = useChronologicalSubscription(
    cache.chronologicalSubscription || {},
    filterSeen,
    showReplies,
    excludeOwnPosts,
    currentFilters.ready && chronologicalEnabled,
    chronologicalEnabled ? chronologicalAuthors : [],
    `${currentFilters.scopeKey}:chronological=${
      chronologicalEnabled ? "enabled" : "disabled"
    }`
  )

  const result = useCombinedPostFetcher({
    getNextPopular: getNextMostPopular,
    getNextChronological,
    hasPopularData,
    hasChronologicalData: chronologicalEnabled && hasChronologicalData,
    cache: cache.combinedPostFetcher || {},
    sourceKey: `${sourceKey}|${chronologicalSourceKey}${discovery.enabled ? `|${discovery.sourceKey}` : ""}`,
    candidateRevision: `${popularRevision}:${chronologicalRevision}`,
    ready: currentFilters.ready,
    visibilitySnapshot,
    popularRatio,
    excludeOwnPosts,
    excludeReplies: filterSeen && !showReplies,
    enforceAuthorDiversity: filterSeen && eligibleAuthorCount > 3,
    discoveryEnabled: discovery.enabled,
    discoveryReady: discovery.ready,
    discoveryPosts: discovery.events,
  })

  return result
}
