import {memo} from "react"
import {matchPath} from "@/navigation/utils"
import UserSearchContent from "@/pages/user-search/components/UserSearchContent"
import SearchFilters from "@/pages/search/components/SearchFilters"
import MarketFilters from "@/pages/market/components/MarketFilters"
import MapFilters from "@/pages/map/components/MapFilters"
import RelayFilters from "@/pages/relay/components/RelayFilters"

interface UnifiedSearchContentProps {
  searchRoute: string
}

const UnifiedSearchContent = memo(function UnifiedSearchContent({
  searchRoute,
}: UnifiedSearchContentProps) {
  // For /u search, show everything (filters + results) like before
  if (searchRoute.startsWith("/u")) {
    return <UserSearchContent />
  }

  // For other searches, show only the filter/search interface
  if (searchRoute.startsWith("/search")) {
    return (
      <div className="pt-4">
        <SearchFilters
          encodedQuery={matchPath(searchRoute, "/search/:query")?.params.query ?? ""}
        />
      </div>
    )
  }

  if (searchRoute.startsWith("/map")) {
    return (
      <div className="pt-4">
        <MapFilters />
      </div>
    )
  }

  if (searchRoute.startsWith("/m")) {
    return (
      <div className="pt-4">
        <MarketFilters />
      </div>
    )
  }

  if (searchRoute.startsWith("/relay")) {
    return (
      <div className="pt-4">
        <RelayFilters />
      </div>
    )
  }

  // Default fallback to user search
  return <UserSearchContent />
})

export default UnifiedSearchContent
