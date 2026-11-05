import type {SocialGraph} from "nostr-social-graph"
import {
  hasProfileSearchExactMatch,
  hasProfileSearchPrefixMatch,
  hasProfileSearchTextMatch,
  type SearchResult,
} from "./profileSearchData"

type SearchHit = {
  item: SearchResult
  score?: number
  source?: "local" | "remote"
}

export const normalizeProfileSearchQuery = (query: string) =>
  query.replace(/_/g, " ").trim().toLowerCase()

// Keep all profile pickers on the same text and social-distance ranking.
export function rankProfileSearchResults(
  results: SearchHit[],
  query: string,
  socialGraph?: Pick<SocialGraph, "getFollowDistance" | "followedByFriends">
): SearchResult[] {
  const normalizedQuery = normalizeProfileSearchQuery(query)
  if (!normalizedQuery) return []

  return results
    .map((result) => {
      const item = {
        ...result.item,
        name: normalizeProfileSearchQuery(result.item.name),
        nip05: result.item.nip05 && normalizeProfileSearchQuery(result.item.nip05),
        aliases: result.item.aliases?.map(normalizeProfileSearchQuery),
      }
      if (
        result.source !== "local" &&
        !hasProfileSearchTextMatch(item, normalizedQuery)
      ) {
        return {...result, adjustedScore: Number.NEGATIVE_INFINITY}
      }

      const followDistance = socialGraph?.getFollowDistance(item.pubKey) ?? 999
      // Social evidence disambiguates names; it must not overwhelm the query.
      const friendsFollowing = Math.min(
        100,
        socialGraph?.followedByFriends(item.pubKey).size ?? 0
      )
      const prefixMatch = hasProfileSearchPrefixMatch(item, normalizedQuery)
      if (normalizedQuery.length === 1) {
        return {
          ...result,
          adjustedScore: prefixMatch
            ? -followDistance + 0.005 * friendsFollowing
            : Number.NEGATIVE_INFINITY,
        }
      }

      const textScore =
        result.source === "local" ? 1 - (result.score ?? 1) : (result.score ?? 0)
      // Unknown profiles have distance 1000. Treating that as ten lost points
      // hid even exact names beneath weak matches from the known network. Keep
      // up to one point of familiarity, less than the three-point exact bonus.
      const distancePenalty =
        0.01 * (followDistance === 0 ? 100 : Math.min(followDistance - 1, 100))
      return {
        ...result,
        adjustedScore:
          textScore * 5 -
          distancePenalty +
          0.005 * friendsFollowing +
          (hasProfileSearchExactMatch(item, normalizedQuery) ? 3 : 0) +
          (prefixMatch ? 1 : 0),
      }
    })
    .filter((result) => Number.isFinite(result.adjustedScore))
    .sort((a, b) => b.adjustedScore - a.adjustedScore)
    .map((result) => result.item)
}
