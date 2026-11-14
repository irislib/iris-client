import type {SocialGraph} from "nostr-social-graph"

// One cache per open Likes view and graph revision. New reaction batches can
// reuse the scores of people already shown, including on heavily liked posts.
export function createLikeOrder(graph: SocialGraph, viewer: string) {
  const root = graph.getRoot()
  const useGraph = !viewer || root === viewer
  const {ids, followedByUser, followersByUser} = graph.getInternalData()
  const rootId = ids.get(root)
  const friends = rootId === undefined ? undefined : followedByUser.get(rootId)
  const scores = new Map<string, {distance: number; peerFollows: number}>()

  function score(pubkey: string) {
    const cached = scores.get(pubkey)
    if (cached) return cached
    let distance = 1000
    if (pubkey === viewer) distance = 0
    else if (useGraph) distance = graph.getFollowDistance(pubkey)
    let peerFollows = 0
    if (distance === 1 && friends?.size) {
      const id = ids.get(pubkey)
      const followers = id === undefined ? undefined : followersByUser.get(id)
      if (followers?.size) {
        // Intersect the smaller indexed neighborhood. A popular person's
        // total follower count does not determine either their score or cost.
        const [smaller, larger] =
          friends.size < followers.size ? [friends, followers] : [followers, friends]
        for (const other of smaller) {
          if (other !== rootId && other !== id && larger.has(other)) peerFollows++
        }
      }
    }
    const result = {distance, peerFollows}
    scores.set(pubkey, result)
    return result
  }

  return function order<T extends {pubkey: string}>(reactions: Iterable<T>): T[] {
    return Array.from(reactions, (event) => ({event, score: score(event.pubkey)}))
      .sort(
        (a, b) =>
          a.score.distance - b.score.distance ||
          b.score.peerFollows - a.score.peerFollows ||
          a.event.pubkey.localeCompare(b.event.pubkey)
      )
      .map(({event}) => event)
  }
}
