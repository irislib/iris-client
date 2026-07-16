import {useSettingsStore} from "@/stores/settings"
import type {SocialGraph} from "nostr-social-graph"
import {LRUCache} from "typescript-lru-cache"
import {getSocialGraph} from "./socialGraph"

const cache = new LRUCache<string, boolean>({maxSize: 100})

export const clearVisibilityCache = () => {
  cache.clear()
}

export const graphConsidersUserOvermuted = (
  graph: SocialGraph,
  pubKey: string,
  threshold = 1
): boolean => {
  if (pubKey === graph.getRoot()) return false

  const muters = graph.getUserMutedBy(pubKey)
  if (muters.size === 0) return false
  if (muters.has(graph.getRoot())) return true

  const nearestOpinion = Object.entries(graph.stats(pubKey))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, counts]) => counts)
    .find(({followers, muters}) => followers + muters > 0)

  return nearestOpinion
    ? nearestOpinion.muters * threshold > nearestOpinion.followers
    : false
}

export const shouldHideUser = (
  pubKey: string,
  threshold = 1,
  allowUnknown = false
): boolean => {
  const {content} = useSettingsStore.getState()
  const instance = getSocialGraph()

  // Check if the result is already in the cache
  const cacheKey = `${pubKey}-${threshold}-${allowUnknown}`
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!
  }

  // Check maxFollowDistanceForReplies setting only if allowUnknown is false
  // When allowUnknown is true, the feed-specific setting should override the global setting
  if (
    !allowUnknown &&
    content.maxFollowDistanceForReplies !== undefined &&
    instance.getFollowDistance(pubKey) > content.maxFollowDistanceForReplies
  ) {
    cache.set(cacheKey, true)
    return true
  }

  if (graphConsidersUserOvermuted(instance, pubKey, threshold)) {
    cache.set(cacheKey, true)
    return true
  }

  cache.set(cacheKey, false)
  return false
}

export const isOvermuted = (pubKey: string, threshold = 1): boolean => {
  const instance = getSocialGraph()
  return graphConsidersUserOvermuted(instance, pubKey, threshold)
}

export const shouldHideEvent = (
  event: {
    pubkey: string
    tags: Array<Array<string>>
  },
  threshold = 1,
  allowUnknown = false
): boolean => {
  // Hide if author should be hidden
  if (shouldHideUser(event.pubkey, threshold, allowUnknown)) {
    return true
  }

  // Hide if event mentions any user that should be hidden
  const mentionedPubkeys = event.tags
    .filter((tag) => tag[0] === "p" && tag[1])
    .map((tag) => tag[1])

  return mentionedPubkeys.some((pubkey) =>
    // mentioned users can be unknown but not overmuted
    shouldHideUser(pubkey, threshold, true)
  )
}
