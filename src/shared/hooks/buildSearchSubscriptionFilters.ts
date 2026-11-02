import type {SearchPlan} from "@/lib/post-search/ranking"
import type {EventFilter} from "@/lib/nostr"

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

function withUntil(filter: EventFilter, untilTimestamp?: number): EventFilter {
  return untilTimestamp ? {...filter, until: untilTimestamp} : filter
}

function dedupeFilters(filters: EventFilter[]) {
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
  filters: EventFilter,
  untilTimestamp?: number,
  fallbackLimit = 100,
  plan?: SearchPlan
): EventFilter | EventFilter[] {
  if (!filters.search) {
    return withUntil(
      {
        ...filters,
        limit: filters.limit ?? fallbackLimit,
      },
      untilTimestamp
    )
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

  if (plan) {
    const tags = buildHashtagVariants(
      filters.search,
      plan.hashtags.map((t) => t.toLowerCase())
    )
    if (tags.length && !plan.terms.length) return {...boundedBaseFilter, "#t": tags}
    const keywords = [...new Set([...tags, ...plan.anchors])]
    const searches = [...new Set([plan.text.toLowerCase(), ...plan.anchors])]
    return dedupeFilters([
      boundedBaseFilter,
      ...(keywords.length ? [{...boundedBaseFilter, "#t": keywords}] : []),
      ...searches.map((search) => ({...boundedBaseFilter, search})),
    ])
  }

  if (hashtags.length > 0 && regularWords.length === 0) {
    return {
      ...boundedBaseFilter,
      "#t": buildHashtagVariants(filters.search, hashtags),
    }
  }

  const filterArray: EventFilter[] = []

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
    // Some indexes interpret multiple words as a phrase. Query individual
    // terms too, then require every whole word in the client-side matcher.
    if (regularWords.length > 1) {
      for (const word of new Set(regularWords)) {
        filterArray.push({...boundedBaseFilter, search: word})
      }
    }
  }

  return dedupeFilters(filterArray)
}
