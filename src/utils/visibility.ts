import {useSettingsStore} from "@/stores/settings"
import type {SocialGraph} from "nostr-social-graph"
import {LRUCache} from "typescript-lru-cache"
import {getSocialGraph} from "./socialGraph"
import {useSocialGraphStore} from "@/stores/socialGraph"

const cache = new LRUCache<string, boolean>({maxSize: 100})
export const SOCIAL_GRAPH_OVERMUTE_THRESHOLD = 3

interface VisibilityEvent {
  pubkey: string
  tags: Array<Array<string>>
}

export interface AlgorithmicVisibilitySnapshot {
  readonly shouldHideRecommendationUser: (pubKey: string) => boolean
  readonly shouldHideAlgorithmicEvent: (event: VisibilityEvent) => boolean
}

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
  const {version, muteListVersion} = useSocialGraphStore.getState()

  // Check if the result is already in the cache
  const cacheKey = [
    instance.getRoot(),
    pubKey,
    threshold,
    allowUnknown,
    content.maxFollowDistanceForReplies,
    version,
    muteListVersion,
  ].join("-")
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

export const graphConsidersUserUnknown = (graph: SocialGraph, pubKey: string): boolean =>
  graph.getFollowDistance(pubKey) >= 1000

/**
 * Unsolicited surfaces are stricter than ordinary thread rendering: an
 * unreachable sender is always hidden, even when the general reply-distance
 * preference is set to unlimited.
 */
export const graphConsidersUnsolicitedUserHidden = (
  graph: SocialGraph,
  pubKey: string,
  maxFollowDistance: number | undefined
): boolean => {
  const root = graph.getRoot()
  if (pubKey === root) return false
  if (graph.getMutedByUser(root).has(pubKey)) return true
  if (graph.getFollowedByUser(root).has(pubKey)) return false

  const distance = graph.getFollowDistance(pubKey)
  return (
    distance >= 1000 ||
    (maxFollowDistance !== undefined && distance > maxFollowDistance) ||
    graphConsidersUserOvermuted(graph, pubKey, SOCIAL_GRAPH_OVERMUTE_THRESHOLD)
  )
}

export const shouldHideSocialGraphUser = (
  pubKey: string,
  allowUnknown = false
): boolean => shouldHideUser(pubKey, SOCIAL_GRAPH_OVERMUTE_THRESHOLD, allowUnknown)

export const shouldHideUnsolicitedUser = (pubKey: string): boolean => {
  const graph = getSocialGraph()
  return graphConsidersUnsolicitedUserHidden(
    graph,
    pubKey,
    useSettingsStore.getState().content.maxFollowDistanceForReplies
  )
}

export const graphConsidersUnsolicitedEventHidden = (
  graph: SocialGraph,
  event: VisibilityEvent,
  senderPubKey: string,
  maxFollowDistance: number | undefined
): boolean => {
  const root = graph.getRoot()
  if (senderPubKey === root) return false
  if (graph.getMutedByUser(root).has(senderPubKey)) return true
  if (graph.getFollowedByUser(root).has(senderPubKey)) return false

  if (graphConsidersUnsolicitedUserHidden(graph, senderPubKey, maxFollowDistance)) {
    return true
  }

  return event.tags.some(
    (tag) =>
      tag[0] === "p" &&
      !!tag[1] &&
      graphConsidersUserOvermuted(graph, tag[1], SOCIAL_GRAPH_OVERMUTE_THRESHOLD)
  )
}

/**
 * Applies one notification visibility policy to the actual sender. A root mute
 * wins, while self/direct follows retain explicit-author precedence and skip
 * mention filtering. Other senders are checked for reachability, distance,
 * overmute consensus, and overmuted identities mentioned by the event. For zap
 * receipts, callers pass the extracted zap sender rather than the receipt signer.
 */
export const shouldHideUnsolicitedEvent = (
  event: VisibilityEvent,
  senderPubKey = event.pubkey
): boolean => {
  const graph = getSocialGraph()
  return graphConsidersUnsolicitedEventHidden(
    graph,
    event,
    senderPubKey,
    useSettingsStore.getState().content.maxFollowDistanceForReplies
  )
}

/**
 * Capture the complete recommendation visibility policy for one mounted feed.
 *
 * Building the overmute set walks every graph identity and each incoming follow
 * and mute edge once. The returned functions only read private Sets, so later
 * graph/settings updates cannot make an already mounted feed mix policies.
 */
export const createAlgorithmicVisibilitySnapshot = (
  graph: SocialGraph,
  maxFollowDistance: number | undefined
): AlgorithmicVisibilitySnapshot => {
  const root = graph.getRoot()
  const directMutes = new Set(graph.getMutedByUser(root))
  const overmutedUsers = new Set(directMutes)
  const {followersByUser, userMutedBy, ids, str} = graph.getInternalData()

  for (const [targetId, targetPubKey] of ids) {
    if (targetPubKey === root || overmutedUsers.has(targetPubKey)) continue

    const muterIds = userMutedBy.get(targetId)
    if (!muterIds?.size) continue

    let nearestDistance = Number.POSITIVE_INFINITY
    let nearestFollowers = 0
    let nearestMuters = 0

    const recordOpinion = (opinionUserId: number, isMute: boolean) => {
      const distance = graph.getFollowDistance(str(opinionUserId))
      // SocialGraph uses 1000 as its unknown/unreachable sentinel. Its stats()
      // implementation likewise excludes opinions from unreachable users.
      if (distance >= 1000) return

      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestFollowers = 0
        nearestMuters = 0
      }
      if (distance !== nearestDistance) return

      if (isMute) nearestMuters += 1
      else nearestFollowers += 1
    }

    for (const followerId of followersByUser.get(targetId) || []) {
      recordOpinion(followerId, false)
    }
    for (const muterId of muterIds) {
      recordOpinion(muterId, true)
    }

    if (
      nearestDistance !== Number.POSITIVE_INFINITY &&
      nearestMuters * SOCIAL_GRAPH_OVERMUTE_THRESHOLD > nearestFollowers
    ) {
      overmutedUsers.add(targetPubKey)
    }
  }

  const allowedRecommendationUsers = new Set<string>()
  for (const pubKey of graph.userIterator(maxFollowDistance)) {
    if (!overmutedUsers.has(pubKey)) allowedRecommendationUsers.add(pubKey)
  }

  const explicitAuthors = new Set([root, ...graph.getFollowedByUser(root)])
  const snapshot: AlgorithmicVisibilitySnapshot = {
    shouldHideRecommendationUser: (pubKey) => !allowedRecommendationUsers.has(pubKey),
    shouldHideAlgorithmicEvent: (event) => {
      if (directMutes.has(event.pubkey)) return true
      if (explicitAuthors.has(event.pubkey)) return false
      if (!allowedRecommendationUsers.has(event.pubkey)) return true

      return event.tags.some(
        (tag) => tag[0] === "p" && !!tag[1] && overmutedUsers.has(tag[1])
      )
    },
  }

  return Object.freeze(snapshot)
}

export const shouldHideEvent = (
  event: VisibilityEvent,
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
