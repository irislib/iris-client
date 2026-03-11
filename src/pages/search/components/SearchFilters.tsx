import {useEffect, useRef, useState, FormEvent, useMemo, memo} from "react"
import {useParams, useNavigate} from "@/navigation"
import {useSearchStore} from "@/stores/search"
import SearchTabSelector from "@/shared/components/search/SearchTabSelector"
import Feed from "@/shared/components/feed/Feed"
import AlgorithmicFeed from "@/shared/components/feed/AlgorithmicFeed"
import {KIND_TEXT_NOTE} from "@/utils/constants"
import SearchInput from "@/shared/components/ui/SearchInput"
import {handleNostrIdentifier} from "@/utils/handleNostrIdentifier"
import {useSearchInputAutofocus} from "@/shared/hooks/useSearchInputAutofocus"

interface SearchFiltersProps {
  showTabSelector?: boolean
}

const SearchFilters = memo(function SearchFilters({
  showTabSelector = true,
}: SearchFiltersProps = {}) {
  const {query} = useParams()
  const decodedQuery = query ? decodeURIComponent(query) : ""
  const navigate = useNavigate()
  const searchInputRef = useRef<HTMLInputElement>(null)

  useSearchInputAutofocus(searchInputRef, "/search")

  // Use store for persistent state
  const searchQuery = useSearchStore((state) => state.searchQuery)
  const setSearchQuery = useSearchStore((state) => state.setSearchQuery)
  const showEventsByUnknownUsers = useSearchStore(
    (state) => state.showEventsByUnknownUsers
  )
  const setShowEventsByUnknownUsers = useSearchStore(
    (state) => state.setShowEventsByUnknownUsers
  )

  // Initialize from URL or store
  const [searchTerm, setSearchTerm] = useState(() => {
    // If we have a query in the URL, use that
    if (decodedQuery) return decodedQuery
    // Otherwise use the stored search query
    return searchQuery
  })

  // Update store when URL query changes (navigation)
  useEffect(() => {
    if (decodedQuery) {
      // URL has a query, update both store and local state
      setSearchQuery(decodedQuery)
      setSearchTerm(decodedQuery)
    } else if (!decodedQuery && searchQuery) {
      // URL has no query but store has query - we navigated to /search
      // This happens when user clears search and submits
      // Keep the input empty (don't populate from store)
      setSearchTerm("")
    }
  }, [decodedQuery, searchQuery, setSearchQuery])

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
        navigate(`/search/${query}`)
      },
    })
  }

  // Memoize the feed config to prevent unnecessary re-renders
  // Use the actual query being displayed (from URL or store)
  const activeQuery = decodedQuery || searchQuery
  const feedConfig = useMemo(() => {
    if (!activeQuery) return null
    return {
      name: "Search Results",
      id: `search-posts-${activeQuery}`,
      showRepliedTo: false,
      followDistance: showEventsByUnknownUsers ? undefined : 5,
      filter: {
        kinds: [KIND_TEXT_NOTE],
        limit: 100,
        ...(activeQuery.trim() && {search: activeQuery}),
      },
    }
  }, [activeQuery, showEventsByUnknownUsers])

  return (
    <div className="flex flex-col gap-2 h-full">
      {showTabSelector && <SearchTabSelector activeTab="posts" />}

      <div className="w-full p-2">
        <form onSubmit={handleSubmit} className="w-full">
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

      {activeQuery && (
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

      <div className="flex-1 w-full">
        {feedConfig ? (
          <Feed feedConfig={feedConfig} />
        ) : (
          <div className="mt-4">
            <AlgorithmicFeed
              type="popular"
              displayOptions={{showDisplaySelector: true}}
            />
          </div>
        )}
      </div>
    </div>
  )
})

export default SearchFilters
