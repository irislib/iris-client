import Header from "@/shared/components/header/Header"
import {ScrollablePageContainer} from "@/shared/components/layout/ScrollablePageContainer"
import {useContext} from "react"
import {useParams, useLocation} from "@/navigation"
import {RouteContext} from "@/navigation/routeContexts"
import {Helmet} from "react-helmet"
import {useIsTwoColumnLayout} from "@/shared/hooks/useIsTwoColumnLayout"
import {HomeRightColumn} from "@/pages/home/components/HomeRightColumn"
import SearchFilters from "./components/SearchFilters"

function SearchPage() {
  const {query} = useParams()
  const decodedQuery = query ? decodeURIComponent(query) : ""
  const isInTwoColumnLayout = useIsTwoColumnLayout()

  const route = useContext(RouteContext)
  const {pathname} = useLocation()
  // The router keeps old pages mounted. Only the visible search owns relay and model work.
  if (route && route.url !== pathname) return null

  // If in two-column layout, show the home-style right column
  if (isInTwoColumnLayout) {
    return <HomeRightColumn />
  }

  // Single column layout - show full interface
  return (
    <div className="flex flex-1 flex-row relative h-full">
      <div className="flex flex-col flex-1 h-full relative">
        <Header title={decodedQuery ? `Search: "${decodedQuery}"` : "Search"} />
        <ScrollablePageContainer className="flex flex-col items-center">
          <div className="flex-1 w-full max-w-3xl flex flex-col gap-2 md:pt-2">
            <SearchFilters />
          </div>
          <Helmet>
            <title>{decodedQuery ? `Search: ${decodedQuery}` : `Search`} / Iris</title>
          </Helmet>
        </ScrollablePageContainer>
      </div>
    </div>
  )
}

export default SearchPage
