import FeedWidget from "./FeedWidget"
import useAlgorithmicFeed from "@/shared/hooks/useAlgorithmicFeed"
import {useFeedStore, type FeedType} from "@/stores/feed"
import {getOrCreateAlgorithmicFeedCache} from "@/utils/memcache"
import {useEffect} from "react"

interface FeedDisplayOptions {
  small?: boolean
  showDisplaySelector?: boolean
  randomSort?: boolean
}

interface AlgorithmicFeedProps {
  type: FeedType
  displayOptions?: FeedDisplayOptions
}

const defaultDisplayOptions: FeedDisplayOptions = {
  small: false,
  showDisplaySelector: true,
  randomSort: false,
}

const feedConfigs = {
  popular: {
    filterSeen: false,
    showReplies: false,
    includeChronological: false,
    emptyMessage: "No popular posts found",
    loadingMessage: "Loading popular posts...",
  },
  "for-you": {
    filterSeen: true,
    showReplies: false,
    includeChronological: true,
    emptyMessage: "No posts found for you",
    loadingMessage: "Loading your personalized feed...",
  },
}

const AlgorithmicFeed = function AlgorithmicFeed({
  type,
  displayOptions = {},
}: AlgorithmicFeedProps) {
  const {small, showDisplaySelector, randomSort} = {
    ...defaultDisplayOptions,
    ...displayOptions,
  }

  const config = feedConfigs[type]

  const cache = getOrCreateAlgorithmicFeedCache(type)

  const {feedDisplayAs: displayAs, setFeedDisplayAs: setDisplayAs} = useFeedStore()

  const {events, loadMore, loading, isStuck} = useAlgorithmicFeed(cache, {
    filterSeen: config.filterSeen,
    showReplies: config.showReplies,
    popularRatio: config.includeChronological ? 0.5 : 1.0,
  })

  useEffect(() => {
    if (events.length === 0 && !loading) loadMore()
    if (isStuck) loadMore()
  }, [isStuck])

  if (loading && events.length === 0) {
    return null
  }

  return (
    <FeedWidget
      events={events}
      loading={loading}
      loadMore={loadMore}
      displayAs={small ? "borderless" : displayAs}
      showDisplaySelector={showDisplaySelector}
      onDisplayAsChange={setDisplayAs}
      emptyMessage={config.emptyMessage}
      loadingMessage={config.loadingMessage}
      small={small}
      randomSort={randomSort}
    />
  )
}

export default AlgorithmicFeed
