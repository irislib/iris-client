import {useParams, useNavigate} from "@/navigation"
import {useIsTopOfStack} from "@/navigation/useIsTopOfStack"
import {useRef, useState, useEffect, FormEvent, useMemo} from "react"
import SearchTabSelector from "@/shared/components/search/SearchTabSelector"
import SearchInput from "@/shared/components/ui/SearchInput"
import {marketStore} from "@/stores/marketstore"
import {GeohashMap} from "@/shared/components/geohash/GeohashMap"
import {AppEvent} from "@/lib/nostr"
import Feed from "@/shared/components/feed/Feed"
import {RiMapPinLine} from "@remixicon/react"
import {CategoryLabel} from "@/shared/components/market/CategoryLabel"
import {buildMarketFeedConfig} from "@/pages/market/utils"
import {useSearchInputAutofocus} from "@/shared/hooks/useSearchInputAutofocus"

interface MarketFiltersProps {
  mapHeight?: string
  categoriesHeight?: string
  includeSearch?: boolean
  mapEvents?: AppEvent[]
}

export default function MarketFilters({
  mapHeight = "calc(100vh - 242px)",
  categoriesHeight = "",
  includeSearch = true,
  mapEvents: providedMapEvents,
}: MarketFiltersProps = {}) {
  const {category} = useParams()
  const navigate = useNavigate()
  const isTopOfStack = useIsTopOfStack()
  const searchInputRef = useRef<HTMLInputElement>(null)

  useSearchInputAutofocus(searchInputRef, "/m")
  // Get search query and additional tags from URL
  const urlParams = new URLSearchParams(window.location.search)
  const searchFromUrl = urlParams.get("q")
  const additionalTagsFromUrl = urlParams.get("t")?.split(",").filter(Boolean) || []
  const [searchTerm, setSearchTerm] = useState(searchFromUrl || "")
  const [selectedTags, setSelectedTags] = useState<string[]>(
    category ? [category, ...additionalTagsFromUrl] : additionalTagsFromUrl
  )
  const [availableTags, setAvailableTags] = useState<
    {tag: string; userCount: number; cooccurrenceScore?: number}[]
  >([])
  const [localMapEvents, setLocalMapEvents] = useState<AppEvent[]>([])

  // Use provided map events if available, otherwise use local collection
  const mapEvents = providedMapEvents || localMapEvents
  const needsLocalCollection = !providedMapEvents

  // Get geohash from URL query params or localStorage fallback
  const geohashFromUrl = urlParams.get("g")
  const storedGeohash = category
    ? localStorage.getItem(`market-geohash-${category}`)
    : null
  const [selectedGeohash, setSelectedGeohash] = useState<string | undefined>(
    geohashFromUrl || storedGeohash || undefined
  )

  const hasCategory = Boolean(category?.trim())

  // Show map by default when category is selected on initial load (URL navigation)
  // But don't auto-switch when selecting in single column mode
  const [showMap, setShowMap] = useState(() => {
    // Only show map initially if we navigated here with a category already in URL
    return hasCategory && window.location.pathname.includes("/m/")
  })

  // Listen for URL changes to update selected geohash, search, and tags
  // Also restore query params if they're missing
  useEffect(() => {
    if (!isTopOfStack) return

    const handleLocationChange = () => {
      const params = new URLSearchParams(window.location.search)
      const g = params.get("g")
      const q = params.get("q")
      const t = params.get("t")
      const additionalTags = t?.split(",").filter(Boolean) || []

      setSelectedGeohash(g || undefined)
      setSearchTerm(q || "")

      // Update selected tags based on URL
      const currentCategory = window.location.pathname.match(/\/m\/([^/]+)/)?.[1]
      if (currentCategory) {
        setSelectedTags([decodeURIComponent(currentCategory), ...additionalTags])
      } else {
        setSelectedTags(additionalTags)
      }
    }

    // Check if we have a stored geohash but it's not in the URL
    if (selectedGeohash && !window.location.search.includes("g=")) {
      const params = new URLSearchParams(window.location.search)
      params.set("g", selectedGeohash)
      const newUrl = `${window.location.pathname}?${params}`
      window.history.replaceState({}, "", newUrl)
    }

    window.addEventListener("popstate", handleLocationChange)

    return () => {
      window.removeEventListener("popstate", handleLocationChange)
    }
  }, [isTopOfStack, selectedGeohash])

  useEffect(() => {
    const loadTags = async () => {
      // Load tags based on selected categories for co-occurrence filtering
      const tags =
        selectedTags.length > 0
          ? await marketStore.getCooccurringTags(selectedTags)
          : await marketStore.getTagsWithCounts()
      setAvailableTags(tags)
    }
    loadTags()
  }, [selectedTags])

  // Feed config for collecting map events when not provided - use same config as main feed
  const mapFeedConfig = useMemo(() => {
    if (!needsLocalCollection) return null

    // Parse URL params to get current filters
    const params = new URLSearchParams(window.location.search)
    const currentCategory = window.location.pathname.match(/\/m\/([^/]+)/)?.[1]
      ? decodeURIComponent(window.location.pathname.match(/\/m\/([^/]+)/)?.[1] as string)
      : undefined
    const geohash = params.get("g") || undefined
    const query = params.get("q") || undefined
    const tags = params.get("t")?.split(",").filter(Boolean) || []

    // Use the same feed config builder as the main page
    return buildMarketFeedConfig(currentCategory, tags, geohash, query)
  }, [needsLocalCollection, window.location.pathname, window.location.search])

  // Track current filter to clear events when it changes
  const [lastFilterId, setLastFilterId] = useState<string | null>(null)

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const params = new URLSearchParams(window.location.search)

    if (searchTerm.trim()) {
      // Add search term to URL
      params.set("q", searchTerm.trim())
    } else {
      // Clear search term from URL when submitting empty
      params.delete("q")
      setSearchTerm("")
    }

    const path = category ? `/m/${encodeURIComponent(category)}` : "/m"
    const queryString = params.toString()
    navigate(`${path}${queryString ? `?${queryString}` : ""}`)
  }

  // Update URL when geohash is selected and trigger a navigation event
  const handleGeohashSelect = (geohash: string) => {
    if (!isTopOfStack) return

    // Don't set wildcard geohashes, just unset
    if (!geohash || geohash === "*") {
      setSelectedGeohash(undefined)
      const params = new URLSearchParams(window.location.search)
      params.delete("g")
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params}`
        : window.location.pathname
      window.history.pushState({}, "", newUrl)
      // Dispatch popstate event to notify other components
      window.dispatchEvent(new PopStateEvent("popstate"))
    } else {
      setSelectedGeohash(geohash)
      const params = new URLSearchParams(window.location.search)
      params.set("g", geohash)
      const newUrl = `${window.location.pathname}?${params}`
      window.history.pushState({}, "", newUrl)
      // Dispatch popstate event to notify other components
      window.dispatchEvent(new PopStateEvent("popstate"))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {includeSearch && (
        <>
          <SearchTabSelector activeTab="market" />

          <div className="w-full p-2">
            <form onSubmit={handleSubmit} className="w-full">
              <SearchInput
                ref={searchInputRef}
                placeholder="Search market..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClear={() => setSearchTerm("")}
              />
            </form>
          </div>
        </>
      )}

      <div className={includeSearch ? "px-2" : ""}>
        {/* Toggle buttons and category label on same row */}
        <div className="flex justify-between items-center flex-wrap gap-2 mb-4">
          <div className="flex gap-2">
            <button
              onClick={() => setShowMap(false)}
              className={`btn btn-sm ${!showMap ? "btn-primary" : "btn-outline"}`}
            >
              Categories
            </button>
            <button
              onClick={() => setShowMap(true)}
              className={`btn btn-sm ${showMap ? "btn-primary" : "btn-outline"}`}
            >
              Map
            </button>
          </div>

          {/* Category, search, and location labels */}
          <div className="flex gap-2 flex-wrap">
            {searchFromUrl && (
              <span className="badge p-4 badge-success badge-lg">
                &quot;{searchFromUrl}&quot;
                <button
                  onClick={() => {
                    if (!isTopOfStack) return

                    // Clear search query from URL
                    const params = new URLSearchParams(window.location.search)
                    params.delete("q")
                    setSearchTerm("")
                    const newUrl = params.toString()
                      ? `${window.location.pathname}?${params}`
                      : window.location.pathname
                    window.history.pushState({}, "", newUrl)
                    window.dispatchEvent(new PopStateEvent("popstate"))
                  }}
                  className="ml-2 hover:text-success-content/80 text-lg"
                >
                  ×
                </button>
              </span>
            )}
            {selectedTags.map((tag, index) => (
              <span key={tag} className="badge p-4 badge-primary badge-lg">
                {tag}
                <button
                  onClick={() => {
                    if (!isTopOfStack) return

                    // Remove this tag from selection
                    const newTags = selectedTags.filter((t) => t !== tag)
                    setSelectedTags(newTags)

                    // Update URL
                    const params = new URLSearchParams(window.location.search)

                    if (index === 0 && newTags.length > 0) {
                      // First tag removed, promote next tag to URL path
                      const [newMain, ...rest] = newTags
                      if (rest.length > 0) {
                        params.set("t", rest.join(","))
                      } else {
                        params.delete("t")
                      }
                      const queryString = params.toString()
                      navigate(
                        `/m/${encodeURIComponent(newMain)}${queryString ? `?${queryString}` : ""}`
                      )
                    } else if (newTags.length === 0) {
                      // All tags removed
                      params.delete("t")
                      const queryString = params.toString()
                      navigate(`/m${queryString ? `?${queryString}` : ""}`)
                    } else {
                      // Non-primary tag removed, just update query params
                      // Keep the first tag in the URL path, update the rest in query params
                      const [mainTag, ...rest] = newTags
                      if (rest.length > 0) {
                        params.set("t", rest.join(","))
                      } else {
                        params.delete("t")
                      }
                      const queryString = params.toString()
                      const newUrl = `/m/${encodeURIComponent(mainTag)}${queryString ? `?${queryString}` : ""}`
                      window.history.pushState({}, "", newUrl)
                      window.dispatchEvent(new PopStateEvent("popstate"))
                    }
                  }}
                  className="ml-2 hover:text-primary-content/80 text-lg"
                >
                  ×
                </button>
              </span>
            ))}
            {selectedGeohash && (
              <span className="badge p-4 badge-info badge-lg flex items-center gap-1">
                <RiMapPinLine className="w-4 h-4" />
                {selectedGeohash}
                <button
                  onClick={() => {
                    if (!isTopOfStack) return

                    setSelectedGeohash(undefined)
                    const params = new URLSearchParams(window.location.search)
                    params.delete("g")
                    const newUrl = params.toString()
                      ? `${window.location.pathname}?${params}`
                      : window.location.pathname
                    window.history.pushState({}, "", newUrl)
                    window.dispatchEvent(new PopStateEvent("popstate"))
                  }}
                  className="ml-2 hover:text-secondary-content/80 text-lg"
                >
                  ×
                </button>
              </span>
            )}
          </div>
        </div>

        {/* Show categories or map based on toggle */}
        {!showMap && (
          <div
            className={`${categoriesHeight} overflow-y-auto flex flex-wrap gap-2 content-start`}
          >
            {availableTags.map((item) => {
              const isSelected = selectedTags.includes(item.tag)
              return (
                <CategoryLabel
                  key={item.tag}
                  category={item.tag}
                  isActive={isSelected}
                  userCount={item.userCount}
                  className="h-fit"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()

                    if (isSelected) {
                      // Deselect
                      const newTags = selectedTags.filter((t) => t !== item.tag)
                      setSelectedTags(newTags)

                      // Update URL
                      const params = new URLSearchParams(window.location.search)
                      if (newTags.length === 0) {
                        params.delete("t")
                        navigate(`/m${params.toString() ? `?${params}` : ""}`)
                      } else {
                        const [main, ...rest] = newTags
                        if (rest.length > 0) {
                          params.set("t", rest.join(","))
                        } else {
                          params.delete("t")
                        }
                        navigate(
                          `/m/${encodeURIComponent(main)}${params.toString() ? `?${params}` : ""}`
                        )
                      }
                    } else {
                      // Select - Don't navigate on single column, just add to filter
                      // Get current tags from URL instead of state to avoid race conditions
                      const currentPath = window.location.pathname
                      const currentCategory = currentPath.match(/\/m\/([^/]+)/)?.[1]
                      const params = new URLSearchParams(window.location.search)
                      const currentAdditionalTags =
                        params.get("t")?.split(",").filter(Boolean) || []

                      if (!currentCategory || currentCategory === "undefined") {
                        // First selection - go to /m/category
                        const newUrl = `/m/${encodeURIComponent(item.tag)}${params.toString() ? `?${params}` : ""}`
                        navigate(newUrl)
                      } else {
                        // Additional selection - keep main tag in path, add new tag to query params
                        const allAdditionalTags = [...currentAdditionalTags, item.tag]
                        params.set("t", allAdditionalTags.join(","))
                        const newUrl = `/m/${encodeURIComponent(currentCategory)}?${params}`
                        navigate(newUrl)
                      }

                      // Update local state
                      const newTags = currentCategory
                        ? [
                            decodeURIComponent(currentCategory),
                            ...currentAdditionalTags,
                            item.tag,
                          ]
                        : [item.tag]
                      setSelectedTags(newTags)
                    }
                  }}
                />
              )
            })}
          </div>
        )}

        {showMap && (
          <GeohashMap
            key={`map-${selectedTags.join("-")}-${searchFromUrl || ""}`}
            geohashes={selectedGeohash ? [selectedGeohash] : []}
            feedEvents={mapEvents}
            onGeohashSelect={handleGeohashSelect}
            height={mapHeight}
          />
        )}
      </div>

      {/* Hidden feed to collect events when mapEvents not provided */}
      {needsLocalCollection && mapFeedConfig && (
        <div className="hidden">
          <Feed
            key="market-map-local"
            feedConfig={mapFeedConfig}
            onEvent={async (event) => {
              // Add events that have either geohash tags or location tags
              const hasGeohash = event.tags.some((tag) => tag[0] === "g" && tag[1])
              const hasLocation = event.tags.some(
                (tag) => tag[0] === "location" && tag[1]
              )
              if (hasGeohash || hasLocation) {
                setLocalMapEvents((prev) => {
                  // Clear old events if filter changed
                  const currentFilterId = mapFeedConfig?.id || ""
                  if (lastFilterId !== currentFilterId) {
                    setLastFilterId(currentFilterId)
                    return [event]
                  }
                  if (prev.some((e) => e.id === event.id)) return prev
                  return [...prev.slice(-499), event]
                })
              }

              // Track category tags for co-occurrence
              const tTags = event.tags.filter((tag) => tag[0] === "t" && tag[1])
              if (tTags.length > 0) {
                await marketStore.addTags(
                  tTags.map((tag) => tag[1]),
                  event.pubkey
                )
              }
            }}
          />
        </div>
      )}
    </div>
  )
}
