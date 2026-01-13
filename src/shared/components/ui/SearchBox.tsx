import {
  MouseEvent as ReactMouseEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react"
import {useSearchStore, CustomSearchResult} from "@/stores/search"
import {useKeyboardNavigation} from "@/shared/hooks/useKeyboardNavigation"
import {UserRow} from "@/shared/components/user/UserRow"
import {isOvermuted} from "@/utils/visibility"
import {search} from "@/utils/profileSearch"
import {useSocialGraph, useGraphSize} from "@/utils/socialGraph"
import {useNavigate} from "@/navigation"
import classNames from "classnames"
import {nip19} from "nostr-tools"
import Icon from "../Icons/Icon"
import SearchInput from "./SearchInput"
import {ndk} from "@/utils/ndk"
import {NOSTR_REGEX, HEX_REGEX, NIP05_REGEX} from "@/utils/validation"
import {useUIStore} from "@/stores/ui"
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
  focusOnNav?: boolean
}

const SearchBox = forwardRef<HTMLInputElement, SearchBoxProps>(
  (
    {
      redirect = true,
      onSelect,
      className,
      searchNotes = false,
      maxResults = MAX_RESULTS,
      focusOnNav = false,
    },
    ref
  ) => {
    const socialGraph = useSocialGraph()
    const [searchResults, setSearchResults] = useState<CustomSearchResult[]>([])
    const {recentSearches, setRecentSearches} = useSearchStore()
    const [isFocused, setIsFocused] = useState(false)
    const [value, setValue] = useState<string>("")
    const inputRef = useRef<HTMLInputElement>(null)
    const navigate = useNavigate()
    const dropdownRef = useRef<HTMLDivElement>(null)
    const navItemClicked = useUIStore((state) => state.navItemClicked)
    // Subscribe to graph changes for re-ranking search results
    const graphSize = useGraphSize()
    const isSocialGraphLoaded = graphSize.users > 1

    // Forward ref to the input element
    useImperativeHandle(ref, () => inputRef.current!, [])

    // Focus when search nav item is clicked
    useEffect(() => {
      if (focusOnNav && navItemClicked.path === "/search") {
        inputRef.current?.focus()
      }
    }, [navItemClicked, focusOnNav])

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

      // Handle lightning: protocol
      if (v.toLowerCase().startsWith("lightning:")) {
        setValue("")
        navigate("/wallet", {state: {lightningInvoice: v.slice(10)}})
        return
      }

      // Strip nostr: prefix if present
      const withoutPrefix = v.replace(/^(nostr:|web\+nostr:)/i, "")

      if (withoutPrefix.match(NOSTR_REGEX)) {
        let result
        try {
          result = nip19.decode(withoutPrefix)
          setValue("")
          if (result.type === "npub") {
            onSelect(result.data)
          } else {
            navigate(`/${withoutPrefix}`)
          }
        } catch (e) {
          setValue("")
          navigate(`/${withoutPrefix}`)
        }
        return
      } else if (withoutPrefix.match(HEX_REGEX)) {
        setValue("")
        onSelect(withoutPrefix)
        return
      } else if (withoutPrefix.match(NIP05_REGEX)) {
        ndk()
          .getUserFromNip05(withoutPrefix)
          .then((user) => {
            if (user) {
              setValue("")
              onSelect(user.pubkey)
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

            const nameLower = result.item.name.toLowerCase()
            const nip05Lower = result.item.nip05?.toLowerCase() || ""
            const prefixMatch =
              nameLower.startsWith(query) || nip05Lower.startsWith(query)

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
    }, [value, navigate, searchNotes, isSocialGraphLoaded])

    // Determine which list is currently being displayed
    const displayedItems = value ? searchResults : recentSearches
    const displayedLength = Math.min(displayedItems.length, maxResults)

    const handleKeyboardSelect = (index: number) => {
      if (displayedLength > 0) {
        const activeItem = displayedItems[index]
        handleSelectResult(activeItem.pubKey, activeItem.query)
      } else if (searchNotes && value.trim()) {
        handleSelectResult("search-notes", value.trim())
      }
    }

    const handleKeyboardEscape = () => {
      setValue("")
      setSearchResults([])
      setIsFocused(false)
    }

    const {activeIndex: activeResult} = useKeyboardNavigation({
      inputRef,
      items: displayedItems.slice(0, maxResults),
      onSelect: handleKeyboardSelect,
      onEscape: handleKeyboardEscape,
      isActive: isFocused || searchResults.length > 0 || recentSearches.length > 0,
    })

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

    const handleSelectResult = (pubKey: string, query?: string) => {
      setValue("")
      setSearchResults([])
      setIsFocused(false) // Hide dropdown for all interactions
      inputRef.current?.blur() // Unfocus the input field

      if (pubKey === "search-notes" && query) {
        navigate(`/search/${encodeURIComponent(query)}`)
      } else {
        // Only check recent searches if we're actually in the recent searches mode (no search value)
        if (!value) {
          // Check if it's a recent search being selected
          const recentResult = recentSearches.find(
            (r: CustomSearchResult) => r.pubKey === pubKey
          )
          if (recentResult) {
            // Reorder recent searches
            const filtered = recentSearches.filter(
              (item: CustomSearchResult) => item.pubKey !== pubKey
            )
            setRecentSearches([recentResult, ...filtered])
          }
        } else {
          // We're selecting from search results, so add to recent searches
          const selectedResult = searchResults.find((r) => r.pubKey === pubKey)
          if (selectedResult) {
            addToRecentSearches(selectedResult)
          }
        }
        onSelect(pubKey)
      }
    }

    const handleSearchResultClick = (pubKey: string, query?: string) => {
      handleSelectResult(pubKey, query)
    }

    const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" || displayedLength > 0 || !searchNotes) {
        return
      }

      const rawQuery = value.trim()
      if (!rawQuery) return

      const withoutPrefix = rawQuery.replace(/^(nostr:|web\+nostr:)/i, "")
      if (
        rawQuery.toLowerCase().startsWith("lightning:") ||
        withoutPrefix.match(NOSTR_REGEX) ||
        withoutPrefix.match(HEX_REGEX) ||
        withoutPrefix.match(NIP05_REGEX)
      ) {
        return
      }

      // Allow immediate search when results haven't populated yet.
      event.preventDefault()
      handleSelectResult("search-notes", rawQuery)
    }

    return (
      <div
        className={classNames("dropdown dropdown-open w-full", className)}
        ref={dropdownRef}
      >
        <SearchInput
          ref={inputRef}
          placeholder="Search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onClear={() => setValue("")}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleInputKeyDown}
          containerClassName={className}
        />
        {(searchResults.length > 0 ||
          (isFocused && !value && recentSearches.length > 0)) && (
          <ul className="dropdown-content menu shadow bg-base-200 rounded-box z-10 w-full border border-info">
            {value ? (
              searchResults.slice(0, maxResults).map((result, index) => (
                <li
                  key={result.pubKey}
                  className={classNames("cursor-pointer rounded-md", {
                    "bg-primary text-primary-content": index === activeResult,
                    "hover:bg-primary/50": index !== activeResult,
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
                <li className="menu-title text-sm px-4 py-2">Recent</li>
                {recentSearches.map((result: CustomSearchResult, index: number) => (
                  <li
                    key={result.pubKey}
                    className={classNames("cursor-pointer rounded-md", {
                      "bg-primary text-primary-content": index === activeResult,
                      "hover:bg-primary/50": index !== activeResult,
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
)

SearchBox.displayName = "SearchBox"

export default SearchBox
