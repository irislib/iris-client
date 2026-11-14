import {useState, useEffect, useRef} from "react"
import {useSearchStore, CustomSearchResult} from "@/stores/search"
import {isOvermuted} from "@/utils/visibility"
import {search} from "@/utils/profileSearch"
import {rankProfileSearchResults} from "@/utils/profileSearchRanking"
import {useSocialGraph, useGraphSize} from "@/utils/socialGraph"
import {nip19} from "nostr-tools"
import {nostr} from "@/utils/nostrClient"
import {NOSTR_REGEX, HEX_REGEX, NIP05_REGEX} from "@/utils/validation"

export interface UseSearchOptions {
  maxResults?: number
  onSelect?: (pubKey: string) => void
  searchNotes?: boolean
}

export function useSearch({
  maxResults = 6,
  onSelect,
  searchNotes = false,
}: UseSearchOptions = {}) {
  const socialGraph = useSocialGraph()
  const [searchResults, setSearchResults] = useState<CustomSearchResult[]>([])
  const [value, setValue] = useState<string>("")
  const {recentSearches, setRecentSearches} = useSearchStore()
  // Use graph size to trigger re-search when graph updates
  const graphSize = useGraphSize()
  const isSocialGraphLoaded = graphSize.reachableUsers > 1

  // Track the latest search to avoid race conditions
  const latestSearchRef = useRef(0)

  useEffect(() => {
    const v = value.trim()
    if (!v) {
      setSearchResults([])
      return
    }

    if (v.match(NOSTR_REGEX)) {
      let result
      try {
        result = nip19.decode(v)
        if (result.type === "npub") {
          onSelect?.(result.data)
        }
      } catch (e) {
        // Handle error if needed
      }
      // Don't clear setValue here - let the parent handle it
      return
    } else if (v.match(HEX_REGEX)) {
      onSelect?.(v)
      // Don't clear setValue here - let the parent handle it
      return
    } else if (v.match(NIP05_REGEX)) {
      nostr()
        .getUserFromNip05(v)
        .then((user) => {
          if (user) {
            onSelect?.(user.pubkey)
            // Don't clear setValue here - let the parent handle it
          }
        })
    }

    const query = v.toLowerCase()
    const searchId = ++latestSearchRef.current

    const applyResults = (results: Awaited<ReturnType<typeof search>>) => {
      // Ignore stale results
      if (searchId !== latestSearchRef.current) return

      const rankedResults = rankProfileSearchResults(
        results.filter((result) => !isOvermuted(result.item.pubKey)),
        query,
        isSocialGraphLoaded ? socialGraph : undefined
      )

      setSearchResults([
        ...(searchNotes
          ? [{pubKey: "search-notes", name: `search notes: ${v}`, query: v}]
          : []),
        ...rankedResults,
      ])
    }

    void search(query, applyResults).then(applyResults)
  }, [value, isSocialGraphLoaded, searchNotes, maxResults, socialGraph])

  const addToRecentSearches = (result: CustomSearchResult) => {
    const filtered = recentSearches.filter(
      (item: CustomSearchResult) => item.pubKey !== result.pubKey
    )
    setRecentSearches([result, ...filtered].slice(0, maxResults))
  }

  const handleSelectResult = (pubKey: string, query?: string) => {
    setValue("")
    setSearchResults([])

    if (pubKey === "search-notes" && query) {
      // Handle search notes if needed
    } else {
      // Add to recent searches if selecting from search results
      if (value) {
        const selectedResult = searchResults.find((r) => r.pubKey === pubKey)
        if (selectedResult) {
          addToRecentSearches(selectedResult)
        }
      }
      onSelect?.(pubKey)
    }
  }

  return {
    value,
    setValue,
    searchResults,
    recentSearches,
    handleSelectResult,
    setRecentSearches,
  }
}
