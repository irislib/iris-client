import {useState, useEffect, useRef} from "react"
import {useSearchStore, CustomSearchResult} from "@/stores/search"
import {isOvermuted} from "@/utils/visibility"
import {search} from "@/utils/profileSearch"
import {hasProfileSearchPrefixMatch} from "@/utils/profileSearchData"
import {useSocialGraph, useGraphSize} from "@/utils/socialGraph"
import {nip19} from "nostr-tools"
import {ndk} from "@/utils/ndk"
import {NOSTR_REGEX, HEX_REGEX, NIP05_REGEX} from "@/utils/validation"

const DEFAULT_DISTANCE = 999
const DISTANCE_PENALTY = 0.01
const FRIEND_BOOST = 0.005
const FUSE_MULTIPLIER = 5
const PREFIX_MATCH_BOOST = 1
const SELF_PENALTY = 100

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
  const isSocialGraphLoaded = graphSize.users > 1 // Graph is loaded if more than just root user

  // Track the latest search to avoid race conditions
  const latestSearchRef = useRef(0)

  useEffect(() => {
    const v = value.trim()
    if (!v) {
      setSearchResults([])
      return
    }

    // Check if it's a single character query
    const isSingleChar = v.length === 1

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
      ndk()
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

    search(query).then((results) => {
      // Ignore stale results
      if (searchId !== latestSearchRef.current) return

      const resultsWithAdjustedScores = results
        .filter((result) => !isOvermuted(result.item.pubKey))
        .map((result) => {
          const fuseScore = 1 - (result.score ?? 1)
          const followDistance = isSocialGraphLoaded
            ? (socialGraph.getFollowDistance(result.item.pubKey) ?? DEFAULT_DISTANCE)
            : DEFAULT_DISTANCE
          const friendsFollowing = isSocialGraphLoaded
            ? socialGraph.followedByFriends(result.item.pubKey).size || 0
            : 0

          const prefixMatch = hasProfileSearchPrefixMatch(result.item, query)

          if (isSingleChar) {
            // For single-character queries, exclude non-prefix matches entirely
            if (!prefixMatch) {
              return {...result, adjustedScore: Number.NEGATIVE_INFINITY}
            }
            // For prefix matches, score by negative follow distance
            const baseScore = -followDistance
            const adjustedScore = baseScore + FRIEND_BOOST * friendsFollowing
            return {...result, adjustedScore}
          }

          // Original multi-character scoring logic
          const distancePenalty =
            followDistance === 0
              ? DISTANCE_PENALTY * SELF_PENALTY
              : DISTANCE_PENALTY * (followDistance - 1)

          const adjustedScore =
            fuseScore * FUSE_MULTIPLIER -
            distancePenalty +
            FRIEND_BOOST * friendsFollowing +
            (prefixMatch ? PREFIX_MATCH_BOOST : 0)

          return {...result, adjustedScore}
        })

      // Sort by adjustedScore in DESCENDING order (higher is better)
      resultsWithAdjustedScores.sort((a, b) => b.adjustedScore - a.adjustedScore)

      setSearchResults([
        ...(searchNotes
          ? [{pubKey: "search-notes", name: `search notes: ${v}`, query: v}]
          : []),
        ...resultsWithAdjustedScores.map((result) => result.item),
      ])
    })
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
