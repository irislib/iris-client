import usePostFetcher from "./usePostFetcher"
import useReactionSubscription from "./useReactionSubscription"
import usePopularityFilters from "./usePopularityFilters"

export default function useSpecialFeedEvents() {
  const {currentFilters, expandFilters} = usePopularityFilters()
  const {getNextMostPopular, hasInitialData} = useReactionSubscription(
    currentFilters,
    expandFilters
  )
  const {events, loadMore, loading} = usePostFetcher(getNextMostPopular, hasInitialData)
  return {
    events,
    loadMore,
    loading,
  }
}
