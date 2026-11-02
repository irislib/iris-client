import type {AppEvent} from "@/lib/nostr"

type Note = Pick<AppEvent, "id" | "content" | "tags" | "pubkey" | "created_at">
const stopWords = new Set(
  "a about an and are as at be by can could describing did do does find for from had has have how i in into is it looking me my of on or post posts search show someone that the their there this to was what where which who with would".split(
    " "
  )
)
const words = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{M}\p{N}_]+/gu) || []
const unique = (values: string[]) => [...new Set(values)]

export function planPostSearch(query: string) {
  const text = query.trim().slice(0, 500)
  const hashtags = unique(
    Array.from(text.matchAll(/(?:^|\s)#([\p{L}\p{M}\p{N}_]+)/gu), (m) => m[1])
  )
  const plain = text.replace(/(?:^|\s)#[\p{L}\p{M}\p{N}_]+/gu, " ")
  const tokens = unique(words(plain))
  const important = tokens.filter((t) => !stopWords.has(t))
  const terms = important.length ? important : tokens
  // Longer content words are usually more selective on phrase-only NIP-50 indexes.
  const anchors = [...terms].sort((a, b) => b.length - a.length).slice(0, 4)
  return {text, terms, anchors, hashtags, phrase: words(plain).join(" ")}
}

export function cachedLexicalMatch(plan: SearchPlan) {
  const cache = new WeakMap<Note, number>()
  return (event: Note) => {
    const cached = cache.get(event)
    if (cached !== undefined) return cached
    const match = lexicalMatch(plan, event)
    cache.set(event, match)
    return match
  }
}

export type SearchPlan = ReturnType<typeof planPostSearch>

export function lexicalMatch(plan: SearchPlan, event: Note) {
  const tags = new Set(
    event.tags
      .filter((t) => t[0] === "t" && t[1])
      .map((t) => t[1].normalize("NFKC").toLowerCase())
  )
  if (!plan.hashtags.every((t) => tags.has(t.normalize("NFKC").toLowerCase()))) return -1
  if (!plan.terms.length) {
    if (plan.hashtags.length) return 1
    return event.content.normalize("NFKC").includes(plan.text.normalize("NFKC")) ? 1 : 0
  }
  const tokens = words(event.content.slice(0, 12000))
  const available = new Set([...tokens, ...tags])
  const coverage =
    plan.terms.filter((term) => available.has(term)).length / plan.terms.length
  if (!coverage) return 0
  const phrase = (" " + tokens.join(" ") + " ").includes(" " + plan.phrase + " ")
  return 0.9 * coverage + (phrase ? 0.1 : 0)
}

// Calibrate cosine similarity on short posts. Values near 0.2 were common
// for off-topic notes, while relevant paraphrases often scored around 0.4.
export function calibratedSimilarity(cosine: number) {
  return Math.min(1, Math.max(0, (cosine - 0.16) / 0.48))
}

export function authorSignal(distance: number, followers: number) {
  const proximity = distance >= 1000 ? 0 : 1 / Math.max(1, distance)
  return 0.65 * proximity + 0.35 * Math.min(1, Math.log1p(followers) / Math.log(101))
}

export function postRelevance(
  lexical: number,
  semantic: number | undefined,
  author: number,
  ageDays: number
) {
  if (lexical < 0 || (lexical < 0.44 && (semantic ?? 0) < 0.42)) return -Infinity
  // A good literal match can stand alone while inference is pending or offline.
  const topical = Math.max(0.64 * lexical, 0.76 * (semantic ?? 0) + 0.24 * lexical)
  const freshness = 1 / (1 + Math.max(0, ageDays) / 30)
  return 0.86 * topical + 0.09 * author + 0.05 * freshness
}

export function rankCandidates<T extends Note>(
  candidates: {event: T; lexical: number; author: number}[],
  scores: ReadonlyMap<string, number>,
  now: number
) {
  const ranked = candidates
    .map(({event, lexical, author}) => ({
      event,
      score: postRelevance(
        lexical,
        scores.get(event.id),
        author,
        (now - (event.created_at ?? 0)) / 86400
      ),
    }))
    .filter((row) => Number.isFinite(row.score))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.event.created_at ?? 0) - (a.event.created_at ?? 0) ||
        a.event.id.localeCompare(b.event.id)
    )
  const primary: T[] = [],
    additional = new Map<string, T[]>()
  for (const {event} of ranked) {
    const others = additional.get(event.pubkey)
    if (others) others.push(event)
    else {
      primary.push(event)
      additional.set(event.pubkey, [])
    }
  }
  return {primary, additional}
}
