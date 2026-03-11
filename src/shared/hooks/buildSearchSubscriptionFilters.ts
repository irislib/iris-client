import type {NDKFilter} from "@/lib/ndk"

function buildHashtagVariants(search: string, hashtags: string[]) {
  const originalTerms = search.split(/\s+/)
  const hashtagVariants: string[] = []

  hashtags.forEach((tag) => {
    hashtagVariants.push(tag)
    originalTerms.forEach((original) => {
      if (original.startsWith("#") && original.substring(1).toLowerCase() === tag) {
        const originalTag = original.substring(1)
        if (originalTag !== tag) {
          hashtagVariants.push(originalTag)
        }
      }
    })
  })

  return [...new Set(hashtagVariants)]
}

function withUntil(filter: NDKFilter, untilTimestamp?: number): NDKFilter {
  return untilTimestamp ? {...filter, until: untilTimestamp} : filter
}

function dedupeFilters(filters: NDKFilter[]) {
  const seen = new Set<string>()

  return filters.filter((filter) => {
    const key = JSON.stringify(filter)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export function buildSearchSubscriptionFilters(
  filters: NDKFilter,
  untilTimestamp?: number,
  fallbackLimit = 100
): NDKFilter | NDKFilter[] {
  if (!filters.search) {
    return withUntil(filters, untilTimestamp)
  }

  const searchTerms = filters.search.toLowerCase().split(/\s+/)
  const hashtags: string[] = []
  const regularWords: string[] = []

  searchTerms.forEach((term) => {
    if (term.startsWith("#") && term.length > 1) {
      hashtags.push(term.substring(1))
    } else if (term.length > 0) {
      regularWords.push(term)
    }
  })

  const baseFilter = {...filters}
  delete baseFilter.search

  const boundedBaseFilter = {
    ...withUntil(baseFilter, untilTimestamp),
    limit: baseFilter.limit ?? fallbackLimit,
  }

  if (hashtags.length > 0 && regularWords.length === 0) {
    return {
      ...boundedBaseFilter,
      "#t": buildHashtagVariants(filters.search, hashtags),
    }
  }

  const filterArray: NDKFilter[] = []

  if (regularWords.length > 0) {
    // Plain recent notes fallback for relays without NIP-50 or word indexing.
    filterArray.push(boundedBaseFilter)
  }

  if (hashtags.length > 0) {
    filterArray.push({
      ...boundedBaseFilter,
      "#t": buildHashtagVariants(filters.search, hashtags),
    })
  }

  if (regularWords.length > 0) {
    filterArray.push({
      ...boundedBaseFilter,
      "#t": regularWords,
    })
    filterArray.push({
      ...boundedBaseFilter,
      search: regularWords.join(" "),
    })
  }

  return dedupeFilters(filterArray)
}
