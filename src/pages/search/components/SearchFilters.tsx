import {useEffect, useRef, useState, FormEvent, useMemo, memo} from "react"
import {Link, useParams, useNavigate} from "@/navigation"
import {useSearchStore} from "@/stores/search"
import SearchTabSelector from "@/shared/components/search/SearchTabSelector"
import Feed from "@/shared/components/feed/Feed"
import {RiEqualizerFill} from "@remixicon/react"
import {useUserStore} from "@/stores/user"
import {DEFAULT_SOCIAL_GRAPH_ROOT, useFollowsFromGraph} from "@/utils/socialGraph"
import {KIND_PICTURE_FIRST, KIND_TEXT_NOTE} from "@/utils/constants"
import SearchInput from "@/shared/components/ui/SearchInput"
import {handleNostrIdentifier} from "@/utils/handleNostrIdentifier"
import {useSearchInputAutofocus} from "@/shared/hooks/useSearchInputAutofocus"
import {getFeedCacheKey} from "@/stores/feed"
import useRecommendationVisibilitySnapshot from "@/shared/hooks/useRecommendationVisibilitySnapshot"

interface SearchFiltersProps {
  encodedQuery?: string
  showTabSelector?: boolean
}

const SearchFilters = memo(function SearchFilters({
  encodedQuery,
  showTabSelector = true,
}: SearchFiltersProps = {}) {
  const {query} = useParams()
  const decodedQuery = decodeURIComponent(encodedQuery ?? query ?? "")
  const navigate = useNavigate()
  const searchInputRef = useRef<HTMLInputElement>(null)

  useSearchInputAutofocus(searchInputRef, "/search")

  const [relevanceStatus, setRelevanceStatus] = useState("")
  // Use store for persistent state
  const {
    postSort,
    setPostSort,
    postType,
    setPostType,
    mediaOnly,
    setMediaOnly,
    setSearchQuery,
    aiSearch,
    setAiSearch,
    searchModel,
    ollamaModel,
    showEventsByUnknownUsers,
    setShowEventsByUnknownUsers,
  } = useSearchStore()
  const ranking = !!decodedQuery && aiSearch && relevanceStatus === "Ranking posts…"

  const [searchTerm, setSearchTerm] = useState(decodedQuery)
  const [filtersOpen, setFiltersOpen] = useState(false)
  useEffect(() => {
    setSearchTerm(decodedQuery)
    if (decodedQuery) setSearchQuery(decodedQuery)
  }, [decodedQuery, setSearchQuery])

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const currentValue = searchTerm.trim()

    // If empty string, reset and go back to /search
    if (!currentValue || currentValue === "") {
      setSearchQuery("")
      setSearchTerm("")
      navigate("/search")
      return
    }

    // Clear immediately for hex-like values
    if (currentValue.match(/^[0-9a-fA-F]{64}$/)) {
      setSearchTerm("")
    }
    await handleNostrIdentifier({
      input: currentValue,
      navigate,
      clearInput: () => setSearchTerm(""),
      onTextSearch: (query) => {
        setSearchQuery(query)
        navigate(`/search/${encodeURIComponent(query)}`)
      },
    })
  }

  const viewer = useUserStore((state) => state.publicKey)
  const restrictLanding = !decodedQuery && !showEventsByUnknownUsers
  const personalFollows = useFollowsFromGraph(restrictLanding ? viewer : null)
  const starterFollows = useFollowsFromGraph(
    restrictLanding && !personalFollows.length ? DEFAULT_SOCIAL_GRAPH_ROOT : null
  )
  const visibility = useRecommendationVisibilitySnapshot(!showEventsByUnknownUsers, {
    useDefaultNetworkWhenEmpty: true,
    maxFollowDistance: 5,
  })
  const feedConfig = useMemo(
    () => ({
      name: decodedQuery ? "Search Results" : "Recent posts",
      id: `search-posts-${decodedQuery}`,
      showRepliedTo: false,
      hideReplies: postType === "originals",
      requiresReplies: postType === "replies",
      requiresMedia: mediaOnly,
      postRelevance:
        decodedQuery && aiSearch ? {model: searchModel, ollamaModel} : undefined,
      followDistance: showEventsByUnknownUsers ? undefined : 5,
      filter: {
        kinds: [KIND_TEXT_NOTE, KIND_PICTURE_FIRST],
        limit: 100,
        ...(decodedQuery && {search: decodedQuery}),
      },
    }),
    [
      decodedQuery,
      postType,
      mediaOnly,
      aiSearch,
      searchModel,
      ollamaModel,
      showEventsByUnknownUsers,
    ]
  )
  // A single direct note request also reads the local event cache. Recommendations
  // on this screen don't need to wait for reactions and a second round of ID lookups.
  const landingFilters = useMemo(
    () =>
      restrictLanding
        ? [
            {
              ...feedConfig.filter,
              authors:
                viewer && personalFollows.length
                  ? [...personalFollows, viewer]
                  : starterFollows,
            },
          ]
        : undefined,
    [restrictLanding, feedConfig.filter, personalFollows, starterFollows, viewer]
  )
  const activeFilters =
    Number(postType !== "all") + Number(mediaOnly) + Number(showEventsByUnknownUsers)

  return (
    <div className="flex flex-col gap-2 h-full">
      {showTabSelector && <SearchTabSelector activeTab="posts" />}

      <div className="w-full p-2">
        <form onSubmit={handleSubmit} className="w-full flex items-center gap-2">
          <SearchInput
            ref={searchInputRef}
            placeholder="Search posts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onClear={() => {
              setSearchTerm("")
              setSearchQuery("")
              navigate("/search")
            }}
            onPaste={async (e) => {
              const pastedText = e.clipboardData.getData("text")
              e.preventDefault()

              // Check if pasted value is a Nostr identifier
              await handleNostrIdentifier({
                input: pastedText,
                navigate,
                clearInput: () => setSearchTerm(""),
                onTextSearch: (query) => {
                  // For regular text, set it
                  setSearchTerm(query)
                },
              })
            }}
          />
        </form>
      </div>

      <div className="px-2 flex flex-wrap items-center gap-2">
        {decodedQuery && (
          <select
            className="select select-sm w-auto"
            aria-label="Result view"
            aria-busy={ranking}
            value={aiSearch ? "ai" : "all"}
            onChange={(e) => setAiSearch(e.target.value === "ai")}
          >
            <option value="all">All results</option>
            <option value="ai">AI selected</option>
          </select>
        )}
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <RiEqualizerFill size={16} aria-hidden="true" />
          Filters
          {activeFilters > 0 && <span className="badge badge-sm">{activeFilters}</span>}
        </button>
        <select
          className="select select-sm w-auto"
          aria-label="Sort posts"
          value={!decodedQuery && postSort === "relevance" ? "newest" : postSort}
          onChange={(e) => setPostSort(e.target.value as typeof postSort)}
        >
          {decodedQuery && <option value="relevance">Relevance</option>}
          <option value="newest">Newest</option>
          <option value="social">Social</option>
        </select>
      </div>
      {filtersOpen && (
        <fieldset className="mx-2 p-3 rounded-box bg-base-200 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
          <legend className="sr-only">Filter posts</legend>
          <label className="flex items-center gap-2">
            Post type
            <select
              className="select select-sm w-auto"
              aria-label="Post type"
              value={postType}
              onChange={(e) => setPostType(e.target.value as typeof postType)}
            >
              <option value="all">All posts</option>
              <option value="originals">Original posts</option>
              <option value="replies">Replies</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={mediaOnly}
              onChange={(e) => setMediaOnly(e.target.checked)}
            />
            With media
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={showEventsByUnknownUsers}
              onChange={(e) => setShowEventsByUnknownUsers(e.target.checked)}
            />
            Show posts from unknown users
          </label>
          <Link to="/settings/content/search-model" className="link">
            Search model settings
          </Link>
        </fieldset>
      )}
      <div className="flex-1 w-full">
        <Feed
          key={getFeedCacheKey(feedConfig)}
          feedConfig={feedConfig}
          searchSort={postSort}
          subscriptionFilters={landingFilters}
          onRelevanceStatus={setRelevanceStatus}
          visibilitySnapshot={visibility.snapshot}
          enabled={showEventsByUnknownUsers || visibility.ready}
          emptyPlaceholder={
            <div className="p-8 text-center text-base-content/70">
              {decodedQuery ? "No matching posts found" : "No recent posts found"}
            </div>
          }
        />
      </div>
    </div>
  )
})

export default SearchFilters
