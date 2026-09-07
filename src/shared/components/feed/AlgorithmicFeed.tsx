import FeedWidget from "./FeedWidget"
import useAlgorithmicFeed from "@/shared/hooks/useAlgorithmicFeed"
import {useFeedStore, type FeedType} from "@/stores/feed"
import {getOrCreateAlgorithmicFeedCache} from "@/utils/memcache"
import {useScrollContainer} from "@/contexts/useScrollContainer"

interface FeedDisplayOptions {
  small?: boolean
  showDisplaySelector?: boolean
}

interface AlgorithmicFeedProps {
  type: FeedType
  displayOptions?: FeedDisplayOptions
  forceShowZapAll?: boolean
  showZapAll?: boolean
}

const defaultDisplayOptions: FeedDisplayOptions = {
  small: false,
  showDisplaySelector: true,
}

const feedConfigs = {
  popular: {
    filterSeen: false,
    showReplies: false,
    includeChronological: false,
    excludeOwnPosts: false,
    emptyMessage: "No popular posts found",
    loadingMessage: "Loading popular posts...",
  },
  "for-you": {
    filterSeen: true,
    showReplies: false,
    includeChronological: true,
    excludeOwnPosts: true,
    emptyMessage: "No posts found for you",
    loadingMessage: "Loading...",
  },
}

const AlgorithmicFeed = function AlgorithmicFeed({
  type,
  displayOptions = {},
  forceShowZapAll = false,
  showZapAll = false,
}: AlgorithmicFeedProps) {
  const scrollContainer = useScrollContainer()

  const {small, showDisplaySelector} = {
    ...defaultDisplayOptions,
    ...displayOptions,
  }

  const config = feedConfigs[type]

  const cache = getOrCreateAlgorithmicFeedCache(type)

  const {feedDisplayAs: displayAs, setFeedDisplayAs: setDisplayAs} = useFeedStore()

  const {events, loadMore, loadMoreKey, loading} = useAlgorithmicFeed(cache, {
    filterSeen: config.filterSeen,
    showReplies: config.showReplies,
    popularRatio: config.includeChronological ? 0.5 : 1.0,
    excludeOwnPosts: config.excludeOwnPosts,
  })

  return (
    <FeedWidget
      events={events}
      loading={loading}
      loadMore={loadMore}
      loadMoreKey={loadMoreKey}
      displayAs={small ? "borderless" : displayAs}
      showDisplaySelector={showDisplaySelector}
      onDisplayAsChange={setDisplayAs}
      emptyMessage={config.emptyMessage}
      loadingMessage={config.loadingMessage}
      small={small}
      scrollContainer={scrollContainer}
      forceShowZapAll={forceShowZapAll}
      showZapAll={showZapAll}
    />
  )
}

export default AlgorithmicFeed
