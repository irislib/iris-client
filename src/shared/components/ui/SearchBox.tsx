import {MouseEvent as ReactMouseEvent, useEffect, useRef, useState} from "react"
import {useSearchStore, CustomSearchResult} from "@/stores/search"
import {UserRow} from "@/shared/components/user/UserRow"
import {shouldHideAuthor} from "@/utils/visibility"
import {searchIndex} from "@/utils/profileSearch"
import socialGraph from "@/utils/socialGraph"
import {useNavigate} from "react-router"
import classNames from "classnames"
import {nip19} from "nostr-tools"
import Icon from "../Icons/Icon"
import {ndk} from "@/utils/ndk"

const NOSTR_REGEX = /(npub|note|nevent|naddr|nprofile)1[a-zA-Z0-9]{58,300}/gi
const HEX_REGEX = /[0-9a-fA-F]{64}/gi
const NIP05_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_RESULTS = 6

// Search ranking constants
const DISTANCE_PENALTY = 0.01 // Penalty per step of social distance
const FRIEND_BOOST = 0.005 // Boost per friend following the result
const DEFAULT_DISTANCE = 999 // Default distance for users not in social graph
const FUSE_MULTIPLIER = 5 // Multiplier to emphasize text match
const PREFIX_MATCH_BOOST = 1
const SELF_PENALTY = 100 // Penalty for self in search results

// this component is used for global search in the Header.tsx
// and for searching assignees in Issues & PRs
interface SearchBoxProps {
  onSelect?: (pubKey: string) => void
  redirect?: boolean
  className?: string
  searchNotes?: boolean
  maxResults?: number
}

function SearchBox({
  redirect = true,
  onSelect,
  className,
  searchNotes = false,
  maxResults = MAX_RESULTS,
}: SearchBoxProps) {
  const [searchResults, setSearchResults] = useState<CustomSearchResult[]>([])
  const [activeResult, setActiveResult] = useState<number>(0)
  const {recentSearches, setRecentSearches} = useSearchStore()
  const [isFocused, setIsFocused] = useState(false)
  const [value, setValue] = useState<string>("")
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const dropdownRef = useRef<HTMLDivElement>(null)

  onSelect =
    onSelect ||
    ((pubKey: string) => {
      try {
        navigate(`/${nip19.npubEncode(pubKey)}`)
      } catch (error) {
        console.error("Error encoding pubkey:", error)
        navigate(`/${pubKey}`)
      }
    })

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
          onSelect(result.data)
        } else {
          navigate(`/${v}`)
        }
      } catch (e) {
        navigate(`/${v}`)
      }
      setValue("")
      return
    } else if (v.match(HEX_REGEX)) {
      onSelect(v)
      setValue("")
      return
    } else if (v.match(NIP05_REGEX)) {
      ndk()
        .getUserFromNip05(v)
        .then((user) => {
          if (user) {
            onSelect(user.pubkey)
            setValue("")
          }
        })
    }

    const query = v.toLowerCase()
    const results = searchIndex.search(query)
    const resultsWithAdjustedScores = results
      .filter((result) => !shouldHideAuthor(result.item.pubKey))
      .map((result) => {
        const fuseScore = 1 - (result.score ?? 1)
        const followDistance =
          socialGraph().getFollowDistance(result.item.pubKey) ?? DEFAULT_DISTANCE
        const friendsFollowing =
          socialGraph().followedByFriends(result.item.pubKey).size || 0

        const nameLower = result.item.name.toLowerCase()
        const nip05Lower = result.item.nip05?.toLowerCase() || ""
        const prefixMatch = nameLower.startsWith(query) || nip05Lower.startsWith(query)

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

    if (!redirect) {
      setActiveResult(1)
    } else {
      setActiveResult(0)
    }
    setSearchResults([
      ...(searchNotes
        ? [{pubKey: "search-notes", name: `search notes: ${v}`, query: v}]
        : []),
      ...resultsWithAdjustedScores.map((result) => result.item),
    ])
  }, [value, navigate, searchNotes])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!value) return

      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveResult((prev) => (prev + 1) % maxResults)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveResult((prev) => (prev - 1 + maxResults) % maxResults)
      } else if (e.key === "Escape") {
        setValue("")
        setSearchResults([])
      } else if (e.key === "Enter" && searchResults.length > 0) {
        const activeItem = searchResults[activeResult]
        if (activeItem.pubKey === "search-notes" && activeItem.query && redirect) {
          navigate(`/search/${activeItem.query}`)
        } else {
          onSelect(activeItem.pubKey)
        }
        setValue("")
        setSearchResults([])
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [searchResults, activeResult, navigate, maxResults])

  // autofocus the input field when not redirecting
  useEffect(() => {
    if (!redirect && inputRef.current) {
      inputRef.current.focus()
    }
  }, [redirect])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsFocused(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const addToRecentSearches = (result: CustomSearchResult) => {
    const filtered = recentSearches.filter(
      (item: CustomSearchResult) => item.pubKey !== result.pubKey
    )
    setRecentSearches([result, ...filtered].slice(0, maxResults))
  }

  const removeFromRecentSearches = (pubKey: string, e: ReactMouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const filtered = recentSearches.filter(
      (item: CustomSearchResult) => item.pubKey !== pubKey
    )
    setRecentSearches(filtered)
    // Reset after a short delay
  }

  const handleSearchResultClick = (pubKey: string, query?: string) => {
    setValue("")
    setSearchResults([])
    setIsFocused(false) // Hide dropdown immediately

    if (pubKey === "search-notes" && query) {
      navigate(`/search/${query}`)
    } else {
      // First check if it's a recent search being clicked
      const recentResult = recentSearches.find(
        (r: CustomSearchResult) => r.pubKey === pubKey
      )
      if (recentResult) {
        // Use setTimeout to delay the reordering until after the dropdown is hidden
        setTimeout(() => {
          const filtered = recentSearches.filter(
            (item: CustomSearchResult) => item.pubKey !== pubKey
          )
          setRecentSearches([recentResult, ...filtered])
        }, 0)
      } else {
        const selectedResult = searchResults.find((r) => r.pubKey === pubKey)
        if (selectedResult) {
          addToRecentSearches(selectedResult)
        }
      }
      onSelect(pubKey)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <label className={classNames("input flex items-center gap-2", className)}>
        <input
          type="text"
          className="grow bg-transparent border-0 outline-none"
          placeholder="Search"
          value={value}
          ref={inputRef}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setIsFocused(true)}
        />
        <Icon name="search-outline" className="text-neutral-content/60" />
      </label>
      {(searchResults.length > 0 ||
        (isFocused && !value && recentSearches.length > 0)) && (
        <ul className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-10 max-h-60 overflow-y-auto p-2 space-y-1">
          {value ? (
            searchResults.slice(0, maxResults).map((result, index) => (
              <li
                key={result.pubKey}
                className={classNames("cursor-pointer rounded-md px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700", {
                  "bg-purple-500 text-white": index === activeResult,
                })}
                onClick={() => handleSearchResultClick(result.pubKey, result.query)}
              >
                {result.pubKey === "search-notes" && searchNotes ? (
                  <div className={classNames("inline", {hidden: !redirect})}>
                    Search notes: <span className="font-bold">{result.query}</span>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <UserRow pubKey={result.pubKey} linkToProfile={redirect} />
                  </div>
                )}
              </li>
            ))
          ) : (
            <>
              <li className="text-sm px-4 py-2 font-semibold text-gray-500 dark:text-gray-400">Recent</li>
              {recentSearches.map((result: CustomSearchResult, index: number) => (
                <li
                  key={result.pubKey}
                  className={classNames("cursor-pointer rounded-md px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700", {
                    "bg-purple-500 text-white": index === activeResult,
                  })}
                  onClick={() => handleSearchResultClick(result.pubKey, result.query)}
                >
                  <div className="flex gap-1 justify-between items-center w-full">
                    <UserRow pubKey={result.pubKey} linkToProfile={redirect} />
                    <div
                      className="p-4 cursor-pointer"
                      onClick={(e) => removeFromRecentSearches(result.pubKey, e)}
                    >
                      <Icon
                        name="close"
                        className="h-3 w-3 opacity-50 hover:opacity-100"
                      />
                    </div>
                  </div>
                </li>
              ))}
            </>
          )}
        </ul>
      )}
    </div>
  )
}

export default SearchBox
