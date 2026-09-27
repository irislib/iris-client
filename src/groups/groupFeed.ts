export type GroupFeedScope = "trusted" | "members"

/** An empty author set must disable the subscription, never become an unfiltered query. */
export function selectGroupFeedAuthors(
  authorityPubkeys: Iterable<string>,
  eligiblePubkeys: ReadonlySet<string>,
  viewer: string | null | undefined,
  scope: GroupFeedScope
): string[] {
  if (scope === "members") return [...eligiblePubkeys].sort()
  const authors = new Set([...authorityPubkeys].filter((key) => eligiblePubkeys.has(key)))
  if (viewer && eligiblePubkeys.has(viewer)) authors.add(viewer)
  return [...authors].sort()
}

const DIVERSITY_WINDOW = 20

/**
 * Preserve feed order while allowing three posts per author in each 20-slot window.
 * Loading more raises the allowance so earlier posts remain reachable.
 * This is burst control; trusted author selection separately bounds identity floods.
 */
export function diversifyGroupFeed<T extends {id: string; pubkey: string}>(
  events: readonly T[],
  displayCount: number,
  maxPerAuthor = 3
): T[] {
  if (
    !Number.isFinite(displayCount) ||
    displayCount <= 0 ||
    !Number.isFinite(maxPerAuthor) ||
    maxPerAuthor < 1
  )
    return []
  const limit = Math.floor(displayCount)
  const authorLimit = Math.floor(maxPerAuthor) * Math.ceil(limit / DIVERSITY_WINDOW)
  const counts = new Map<string, number>()
  const ids = new Set<string>()
  const selected: T[] = []
  for (const event of events) {
    if (ids.has(event.id)) continue
    ids.add(event.id)
    const count = counts.get(event.pubkey) ?? 0
    if (count >= authorLimit) continue
    counts.set(event.pubkey, count + 1)
    selected.push(event)
    if (selected.length >= limit) break
  }
  return selected
}
