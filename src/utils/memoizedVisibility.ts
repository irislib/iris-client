import {LRUCache} from "typescript-lru-cache"
import {useSettingsStore} from "@/stores/settings"
import socialGraph from "./socialGraph"

const visibilityCache = new LRUCache<string, boolean>({maxSize: 5000})
const authorStatsCache = new LRUCache<string, {
  followDistance: number
  followers: number
  following: number
  mutedCount: number
  followedCount: number
}>({maxSize: 2000})

const getCacheKey = (pubKey: string, threshold: number, hideUnknown: boolean, hideMuted: boolean): string => {
  return `${pubKey}:${threshold}:${hideUnknown}:${hideMuted}`
}

export const shouldHideAuthorMemoized = (pubKey: string, threshold = 1, allowUnknown = false): boolean => {
  const {content} = useSettingsStore.getState()
  const cacheKey = getCacheKey(pubKey, threshold, content.hideEventsByUnknownUsers, content.hidePostsByMutedMoreThanFollowed)
  
  const cached = visibilityCache.get(cacheKey)
  if (typeof cached === 'boolean') {
    return cached
  }
  
  let stats = authorStatsCache.get(pubKey)
  if (!stats) {
    stats = {
      followDistance: socialGraph().getFollowDistance(pubKey),
      followers: socialGraph().getFollowersByUser(pubKey).size,
      following: socialGraph().getFollowedByUser(pubKey).size,
      mutedCount: socialGraph().getMutedByUser(pubKey).size,
      followedCount: socialGraph().getFollowedByUser(pubKey).size,
    }
    authorStatsCache.set(pubKey, stats)
  }

  let result = false
  
  if (!allowUnknown && content.hideEventsByUnknownUsers && stats.followDistance >= 5) {
    result = true
  } else if (stats.followers === 0 || stats.following === 0) {
    result = false
  } else if (stats.following / stats.followers > threshold) {
    result = false
  } else if (!content.hidePostsByMutedMoreThanFollowed) {
    result = false
  } else {
    result = stats.mutedCount > stats.followedCount
  }

  visibilityCache.set(cacheKey, result)
  return result
}

export const clearVisibilityCache = () => {
  visibilityCache.clear()
  authorStatsCache.clear()
}
