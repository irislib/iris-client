import {useMemo, useState, useEffect, FormEvent} from "react"
import RightColumn from "@/shared/components/RightColumn.tsx"
import PopularFeed from "@/shared/components/feed/PopularFeed"
import useHistoryState from "@/shared/hooks/useHistoryState"
import SearchBox from "@/shared/components/ui/SearchBox"
import Header from "@/shared/components/header/Header"
import {Filter} from "nostr-tools"
import Feed from "@/shared/components/feed/Feed.tsx"
import {useParams, useNavigate} from "react-router"
import Widget from "@/shared/components/ui/Widget"
import {Helmet} from "react-helmet"
import {useSettingsStore} from "@/stores/settings"

function SearchPage() {
  const {query} = useParams()
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState(query || "")
  const [activeTab, setActiveTab] = useHistoryState<"people" | "posts" | "market">(
    query ? "posts" : "people",
    "searchTab"
  )
  const [forceUpdate, setForceUpdate] = useState(0)

  const {content} = useSettingsStore()
  const [showEventsByUnknownUsers, setShowEventsByUnknownUsers] = useHistoryState(
    !content.hideEventsByUnknownUsers,
    "searchShowEventsByUnknownUsers"
  )

  useEffect(() => {
    setSearchTerm(query?.toLowerCase() || "")
    if (query) {
      setActiveTab("posts")
    }
  }, [query, setActiveTab])

  useEffect(() => {
    setForceUpdate((prev) => prev + 1)
  }, [activeTab])

  const filters: Filter = useMemo(
    () => ({
      kinds: activeTab === "market" ? [30402] : [1],
      search: query,
    }),
    [query, activeTab]
  )

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (searchTerm !== query) {
      navigate(`/search/${searchTerm}`)
    }
  }

  return (
    <div className="flex flex-row">
      <div key={query} className="flex flex-col items-center flex-1">
        <Header title={query ? `Search: "${query}"` : "Search"} />
        <div className="p-2 flex-1 w-full max-w-screen-lg flex flex-col gap-4">
          {activeTab === "people" ? (
            <SearchBox searchNotes={true} maxResults={10} />
          ) : (
            <form onSubmit={handleSubmit} className="flex w-full">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search"
                className="input input-bordered w-full"
              />
              <button type="submit" className="btn btn-primary ml-2">
                Search
              </button>
            </form>
          )}
          <div className="px-2 flex gap-2 overflow-x-auto">
            <button
              className={`btn btn-sm ${activeTab === "people" ? "btn-primary" : "btn-neutral"}`}
              onClick={() => setActiveTab("people")}
            >
              People
            </button>
            <button
              className={`btn btn-sm ${activeTab === "posts" ? "btn-primary" : "btn-neutral"}`}
              onClick={() => setActiveTab("posts")}
            >
              Posts
            </button>
            <button
              className={`btn btn-sm ${activeTab === "market" ? "btn-primary" : "btn-neutral"}`}
              onClick={() => setActiveTab("market")}
            >
              Market
            </button>
          </div>

          {query && activeTab !== "people" && (
            <div className="flex items-center gap-2 p-2">
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={showEventsByUnknownUsers}
                onChange={(e) => setShowEventsByUnknownUsers(e.target.checked)}
              />
              <span className="text-sm">Show posts from unknown users</span>
            </div>
          )}

          {query && (
            <Feed
              key={`${activeTab}-${query}`}
              filters={filters}
              showRepliedTo={false}
              cacheKey={`search-${activeTab}-${query}`}
              forceUpdate={forceUpdate}
              showEventsByUnknownUsers={showEventsByUnknownUsers}
            />
          )}
          {!query && (
            <div className="mt-4">
              <PopularFeed small={false} randomSort={true} />
            </div>
          )}
        </div>
        <Helmet>
          <title>{query ? `Search: ${query}` : `Search`} / Iris</title>
        </Helmet>
      </div>
      <RightColumn>
        {() => (
          <>
            <Widget title="Popular">
              <PopularFeed />
            </Widget>
          </>
        )}
      </RightColumn>
    </div>
  )
}

export default SearchPage
