import usePostFetcher from "./usePostFetcher"
import useReactionSubscription from "./useReactionSubscription"
import usePopularityFilters from "./usePopularityFilters"

export default function useSpecialFeedEvents() {
  const {currentFilters, expandFilters} = usePopularityFilters()
  const {getNextMostPopular} = useReactionSubscription(currentFilters, expandFilters)
  const {events, loadMore, loading} = usePostFetcher(getNextMostPopular)
  return {
    events,
    loadMore,
    loading,
  }
}
