/** Keep priority unless it would repeat an author or strand their posts at the end. */
export function avoidConsecutiveAuthors<T extends {pubkey: string}>(
  events: readonly T[],
  previousAuthor?: string
): T[] {
  const remaining = [...events]
  const ordered: T[] = []
  const counts = new Map<string, number>()
  for (const event of remaining) {
    counts.set(event.pubkey, (counts.get(event.pubkey) ?? 0) + 1)
  }
  while (remaining.length > 0) {
    // A majority author must go next, if possible: using a rarer author now
    // would leave too few separators for the remaining majority posts.
    const urgentAuthor = [...counts].find(
      ([author, count]) => author !== previousAuthor && count > remaining.length / 2
    )?.[0]
    const alternative = remaining.findIndex((event) =>
      urgentAuthor ? event.pubkey === urgentAuthor : event.pubkey !== previousAuthor
    )
    const [event] = remaining.splice(Math.max(0, alternative), 1)
    ordered.push(event)
    counts.set(event.pubkey, counts.get(event.pubkey)! - 1)
    previousAuthor = event.pubkey
  }
  return ordered
}

/** Leave repeats pending when there is no other author to separate them. */
export function selectNonConsecutiveAuthors<T extends {pubkey: string}>(
  events: readonly T[]
): T[] {
  let previousAuthor: string | undefined
  return events.filter((event) => {
    if (event.pubkey === previousAuthor) return false
    previousAuthor = event.pubkey
    return true
  })
}

/** Keep displayed posts stable and interleave deferred posts with new arrivals. */
export function appendDiverseAuthors<T extends {pubkey: string}>(
  previous: readonly T[],
  incoming: readonly T[],
  isHidden: (event: T) => boolean = () => false
): T[] {
  let previousAuthor: string | undefined
  const deferred: T[] = []
  const stable = previous.filter((event) => {
    // Retain hidden posts in place so unmuting can restore their original order.
    if (isHidden(event)) return true
    if (event.pubkey === previousAuthor) {
      deferred.push(event)
      return false
    }
    previousAuthor = event.pubkey
    return true
  })
  return [
    ...stable,
    ...avoidConsecutiveAuthors([...deferred, ...incoming], previousAuthor),
  ]
}

/** Pick from every available author before taking another round of their posts. */
export function orderByAuthorRound<T extends {pubkey: string}>(
  events: readonly T[],
  previousAuthor?: string
): T[] {
  const byAuthor = new Map<string, T[]>()
  for (const event of events) {
    const queue = byAuthor.get(event.pubkey) ?? []
    queue.push(event)
    byAuthor.set(event.pubkey, queue)
  }
  if (events.length === 0) return []
  const authors = [...byAuthor.keys()]
  const start = (authors.indexOf(previousAuthor ?? "") + 1) % authors.length
  const rotatedAuthors = [...authors.slice(start), ...authors.slice(0, start)]
  const ordered: T[] = []
  for (let round = 0; ordered.length < events.length; round++) {
    for (const author of rotatedAuthors) {
      const event = byAuthor.get(author)?.[round]
      if (event) ordered.push(event)
    }
  }
  return ordered
}
