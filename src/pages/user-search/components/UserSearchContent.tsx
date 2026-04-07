import {useParams, useNavigate} from "@/navigation"
import {useRef, useMemo, useState, useEffect} from "react"
import {useSearch} from "@/shared/hooks/useSearch"
import {useKeyboardNavigation} from "@/shared/hooks/useKeyboardNavigation"
import {UserRow} from "@/shared/components/user/UserRow"
import InfiniteScroll from "@/shared/components/ui/InfiniteScroll"
import {useSocialGraph} from "@/utils/socialGraph"
import {nip19} from "nostr-tools"
import Icon from "@/shared/components/Icons/Icon"
import SearchTabSelector from "@/shared/components/search/SearchTabSelector"
import {SocialGraphWidget} from "@/shared/components/SocialGraphWidget"
import classNames from "classnames"
import {handleNostrIdentifier} from "@/utils/handleNostrIdentifier"
import {useSearchInputAutofocus} from "@/shared/hooks/useSearchInputAutofocus"
import {useStableSearchResults} from "../stableSearchResults"

export default function UserSearchContent() {
  const socialGraph = useSocialGraph()
  const {query} = useParams()
  const decodedQuery = query ? decodeURIComponent(query) : ""
  const navigate = useNavigate()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [displayCount, setDisplayCount] = useState(20)
  const [searchValue, setSearchValue] = useState(decodedQuery)

  useSearchInputAutofocus(searchInputRef, "/u")

  const peopleSearch = useSearch({
    maxResults: 10,
    onSelect: (pubKey: string) => {
      try {
        navigate(`/${nip19.npubEncode(pubKey)}`)
      } catch (error) {
        console.error("Error encoding pubkey:", error)
        navigate(`/${pubKey}`)
      }
    },
  })

  // Sync our local state with the search hook (one way only)
  useEffect(() => {
    peopleSearch.setValue(searchValue)
  }, [searchValue])

  const stableSearch = useStableSearchResults(searchValue, peopleSearch.searchResults)

  const rootUser = socialGraph.getRoot()
  const follows = socialGraph.getFollowedByUser(rootUser)

  const displayUsers = useMemo(() => {
    if (searchValue.trim()) {
      return stableSearch.visibleResults.map((result) => ({
        pubkey: result.pubKey,
        followedByCount: socialGraph.followedByFriends(result.pubKey).size,
      }))
    }

    // Show follows list only when no search term
    if (!follows) return []

    return Array.from(follows)
      .map((pubkey) => ({
        pubkey,
        followedByCount: socialGraph.followedByFriends(pubkey).size,
      }))
      .sort((a, b) => b.followedByCount - a.followedByCount)
  }, [follows, socialGraph, rootUser, searchValue, stableSearch.visibleResults])

  const handleSelectUser = (index: number) => {
    const user = displayUsers[index]
    if (user) {
      try {
        navigate(`/${nip19.npubEncode(user.pubkey)}`)
      } catch (error) {
        console.error("Error encoding pubkey:", error)
        navigate(`/${user.pubkey}`)
      }
    }
  }

  const handleEscape = () => {
    setSearchValue("")
  }

  const {activeIndex} = useKeyboardNavigation({
    inputRef: searchInputRef,
    items: displayUsers.slice(0, displayCount),
    onSelect: handleSelectUser,
    onEscape: handleEscape,
    isActive: true,
  })

  const loadMore = () => {
    if (displayCount < displayUsers.length) {
      setDisplayCount((prev) => Math.min(prev + 20, displayUsers.length))
    }
  }

  return (
    <div className="flex flex-col items-center h-full">
      <div className="flex-1 w-full flex flex-col gap-2 md:pt-2">
        <SearchTabSelector activeTab="people" />

        <div className="w-full">
          <div className="w-full p-2">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (searchValue.trim()) {
                  navigate(`/u/${encodeURIComponent(searchValue.trim())}`)
                }
              }}
              className="w-full"
            >
              <label className="input input-bordered flex items-center gap-2 w-full">
                <input
                  ref={searchInputRef}
                  type="text"
                  className="grow"
                  placeholder="Search people..."
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  onPaste={async (e) => {
                    const pastedText = e.clipboardData.getData("text")
                    e.preventDefault()

                    await handleNostrIdentifier({
                      input: pastedText,
                      navigate,
                      clearInput: () => setSearchValue(""),
                      onTextSearch: (query) => {
                        // For regular text, set it
                        setSearchValue(query)
                      },
                    })
                  }}
                />
                <Icon name="search-outline" className="text-neutral-content/60" />
              </label>
            </form>
          </div>

          <div className="px-2 min-h-9 flex items-center justify-end">
            {searchValue.trim() && stableSearch.hasPendingResults ? (
              <button
                type="button"
                className="btn btn-xs btn-outline"
                onClick={stableSearch.applyPendingResults}
              >
                Update results
              </button>
            ) : null}
          </div>

          {!searchValue.trim() && <SocialGraphWidget background={false} />}

          <div className="mt-4">
            <InfiniteScroll onLoadMore={loadMore}>
              <div className="flex flex-col gap-2 px-4">
                {displayUsers.slice(0, displayCount).map(({pubkey}, index) => (
                  <div
                    key={pubkey}
                    className={classNames("rounded-md cursor-pointer p-2", {
                      "bg-primary text-primary-content": index === activeIndex,
                      "hover:bg-primary/20": index !== activeIndex,
                    })}
                  >
                    <UserRow pubKey={pubkey} linkToProfile={true} />
                  </div>
                ))}
              </div>
            </InfiniteScroll>
          </div>
        </div>
      </div>
    </div>
  )
}
