import Header from "@/shared/components/header/Header"
import RightColumn from "@/shared/components/RightColumn"
import PopularWidget from "@/shared/components/feed/PopularWidget"
import {ScrollablePageContainer} from "@/shared/components/layout/ScrollablePageContainer"
import {Activity} from "react"
import {useParams} from "@/navigation"
import {useIsTopOfStack} from "@/navigation/useIsTopOfStack"
import {Helmet} from "react-helmet"
import SearchFilters from "./components/SearchFilters"

function SearchPage() {
  const {query} = useParams()
  const decodedQuery = query ? decodeURIComponent(query) : ""

  const active = useIsTopOfStack()

  return (
    <Activity mode={active ? "visible" : "hidden"}>
      <div className="flex flex-1 flex-row relative h-full">
        <div className="flex flex-col flex-1 min-w-0 h-full relative">
          <Header title={decodedQuery ? `Search: "${decodedQuery}"` : "Search"} />
          <ScrollablePageContainer className="flex flex-col items-center">
            <div className="flex-1 w-full flex flex-col gap-2 md:pt-2">
              <SearchFilters />
            </div>
            <Helmet>
              <title>{decodedQuery ? `Search: ${decodedQuery}` : `Search`} / Iris</title>
            </Helmet>
          </ScrollablePageContainer>
        </div>
        <RightColumn>
          <PopularWidget />
        </RightColumn>
      </div>
    </Activity>
  )
}

export default SearchPage
