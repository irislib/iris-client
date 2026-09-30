import {EventFilter} from "@/lib/nostr"
import {KIND_CLASSIFIED} from "@/utils/constants"

// Helper function to build market feed config
export function buildMarketFeedConfig(
  category: string | undefined,
  additionalTags: string[],
  selectedGeohash: string | undefined,
  searchQuery: string | undefined
) {
  const hasCategory = Boolean(category?.trim())

  if (hasCategory || additionalTags.length > 0 || selectedGeohash || searchQuery) {
    const filter: EventFilter = {
      kinds: [KIND_CLASSIFIED],
    }

    // Collect all selected tags
    const allTags: string[] = []
    if (hasCategory && category) {
      allTags.push(category)
    }
    allTags.push(...additionalTags)

    if (allTags.length > 0) {
      // For multiple tags, use search to implement AND logic
      const searchTerms = allTags.map((tag) => `#${tag}`).join(" ")
      filter.search = searchQuery ? `${searchQuery} ${searchTerms}` : searchTerms
    } else if (searchQuery) {
      filter.search = searchQuery
    }

    if (selectedGeohash) {
      filter["#g"] = [selectedGeohash]
    }

    return {
      name: `Market${allTags.length > 0 ? `: ${allTags.join(", ")}` : ""}${selectedGeohash ? " (filtered by location)" : ""}${searchQuery ? ` (search: ${searchQuery})` : ""}`,
      id: `search-market-${allTags.join("-")}-${selectedGeohash || ""}-${searchQuery || ""}`,
      showRepliedTo: false,
      filter,
    }
  }

  return {
    name: "Market",
    id: "market",
    showRepliedTo: false,
    filter: {
      kinds: [KIND_CLASSIFIED],
      limit: 100,
    },
    followDistance: 3,
    hideReplies: true,
  }
}
