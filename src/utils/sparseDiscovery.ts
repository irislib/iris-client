import type {SocialGraph} from "nostr-social-graph"
import type {Event} from "nostr-tools"
import type {AlgorithmicVisibilitySnapshot} from "./visibility"
import {isFeedReply} from "./feedReplies"
import {orderByAuthorRound} from "./authorDiversity"

export const DISCOVERY_MAX_AUTHORS = 8
export const DISCOVERY_MAX_EVENTS_PER_AUTHOR = 8
export const DISCOVERY_MAX_EVENTS = 64
export const DISCOVERY_MAX_BYTES = 64 * 1024
export const DISCOVERY_TIMEOUT_MS = 8000

/** A small fixed second-degree sample, balanced across the viewer's follows. */
export function selectSparseDiscoveryAuthors(
  graph: SocialGraph,
  visibility: AlgorithmicVisibilitySnapshot,
  recommendationRoot: string,
  viewer?: string | null
) {
  const direct = graph.getFollowedByUser(recommendationRoot)
  if (direct.size > 3) return []
  const {followersByUser, ids} = graph.getInternalData()
  const followers = (key: string) => followersByUser.get(ids.id(key))?.size ?? 0
  const queues = [...direct]
    .filter((key) => !visibility.shouldHideRecommendationUser(key))
    .sort()
    .map((branch) =>
      [...graph.getFollowedByUser(branch)]
        .filter(
          (key) =>
            key !== viewer &&
            key !== recommendationRoot &&
            !direct.has(key) &&
            !visibility.shouldHideRecommendationUser(key) &&
            (visibility.discoveryDistance?.(key) ?? graph.getFollowDistance(key)) === 2
        )
        .sort((a, b) => followers(b) - followers(a) || a.localeCompare(b))
    )
  const selected = new Set<string>()
  let progress = true
  while (selected.size < DISCOVERY_MAX_AUTHORS && progress) {
    progress = false
    for (const queue of queues) {
      while (queue.length && selected.has(queue[0])) queue.shift()
      const next = queue.shift()
      if (!next) continue
      selected.add(next)
      progress = true
      if (selected.size === DISCOVERY_MAX_AUTHORS) break
    }
  }
  return [...selected]
}

/** Budget signed records before reply/visibility filters, so sparse authors do
 * not trigger extra queries. Relay duplicate arrivals do not spend this budget.
 * These are accepted JSON bytes, not a claim about transport bytes. */
export function selectSparseDiscoveryPosts<T extends Event>(
  authors: readonly string[],
  records: readonly T[]
): T[] {
  const seen = new Set<string>()
  const accepted: T[] = []
  let bytes = 0
  const encoder = new TextEncoder()
  for (const author of authors) {
    const recent = records
      .filter((event) => event.pubkey === author && event.kind === 1)
      .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
    let count = 0
    for (const event of recent) {
      if (seen.has(event.id)) continue
      if (count >= DISCOVERY_MAX_EVENTS_PER_AUTHOR) break
      seen.add(event.id)
      count += 1
      // AppEvent carries runtime fields; serialize only the signed record.
      const {id, pubkey, created_at, kind, tags, content, sig} = event
      const size = encoder.encode(
        JSON.stringify({id, pubkey, created_at, kind, tags, content, sig}) + "\n"
      ).length
      if (accepted.length >= DISCOVERY_MAX_EVENTS || bytes + size > DISCOVERY_MAX_BYTES)
        return originals(accepted)
      accepted.push(event)
      bytes += size
    }
  }
  return originals(accepted)
}

function originals<T extends Event>(events: T[]) {
  const counts = new Map<string, number>()
  return orderByAuthorRound(
    events.filter((event) => {
      if (isFeedReply(event)) return false
      const count = counts.get(event.pubkey) ?? 0
      if (count === 2) return false
      counts.set(event.pubkey, count + 1)
      return true
    })
  )
}
