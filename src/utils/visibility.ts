import {useSettingsStore} from "@/stores/settings"
import {LRUCache} from "typescript-lru-cache"
import socialGraph from "./socialGraph"

const cache = new LRUCache<string, boolean>({maxSize: 100})

export const shouldHideAuthor = (
  pubKey: string,
  threshold = 1,
  allowUnknown = false
): boolean => {
  const {content} = useSettingsStore.getState()
  const instance = socialGraph()

  // Check if the result is already in the cache
  const cacheKey = `${pubKey}-${threshold}`
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!
  }

  // Check hideEventsByUnknownUsers setting
  if (
    !allowUnknown &&
    content.hideEventsByUnknownUsers &&
    instance.getFollowDistance(pubKey) >= 5
  ) {
    cache.set(cacheKey, true)
    return true
  }

  const hasMuters = instance.getUserMutedBy(pubKey).size > 0

  // for faster checks, if no one mutes, return false
  if (!hasMuters) {
    cache.set(cacheKey, false)
    return false
  }

  // Check hidePostsByMutedMoreThanFollowed setting
  if (content.hidePostsByMutedMoreThanFollowed) {
    const mutedCount = instance.getMutedByUser(pubKey).size
    const followedCount = instance.getFollowedByUser(pubKey).size
    // Use the threshold parameter when comparing
    if (mutedCount * threshold > followedCount) {
      cache.set(cacheKey, true)
      return true
    }
  }

  const userStats = instance.stats(pubKey)

  // Sort numeric distances ascending
  const distances = Object.keys(userStats)
    .map(Number)
    .sort((a, b) => a - b)

  // Look at the smallest distance that has any followers/muters
  for (const distance of distances) {
    const {followers, muters} = userStats[distance]
    if (followers + muters === 0) {
      continue // No one at this distance has an opinion; skip
    }

    // If, at the closest distance with an opinion, muters >= followers => hide
    // Apply threshold to this comparison
    const shouldHide = muters * threshold >= followers
    cache.set(cacheKey, shouldHide)
    return shouldHide
  }

  // If we get here, no one has an opinion (no followers or muters)
  if (allowUnknown) {
    cache.set(cacheKey, false)
    return false
  }

  // If no one anywhere follows or mutes, default to hide
  cache.set(cacheKey, true)
  return true
}
