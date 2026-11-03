import type {AppEvent} from "@/lib/nostr"
import {words, type SearchPlan} from "./query"
export {planPostSearch, type SearchPlan} from "./query"

type Note = Pick<AppEvent, "id" | "content" | "tags" | "pubkey" | "created_at">
const references = /(?:nostr:)?(?:npub|nprofile|note|nevent|naddr)1[a-z0-9]+|#\[\d+\]/gi
const conversational = new Set(
  "a ah awesome bro cheers cool d dude eh excellent for good great haha hey huh i interesting is it its like looks love man neat nice oh ok okay pretty really s sharing so sounds stuff such super t thank thanks that the this very wow yeah yep yes you".split(
    " "
  )
)

// Hosts and opaque attachment IDs describe storage, not the subject of a photo.
function readableLink(url: string) {
  const path = url.split(/[?#]/, 1)[0]
  if (/\.(?:jpe?g|png|webp|gif|avif|heic|svg|mp4|m4v|mov|webm)$/i.test(path)) return ""
  return path
    .replace(/^https?:\/\//i, "")
    .replace(/[\w-]{32,}|\b[\da-f]{12,}\b/gi, " ")
    .replace(/[-_/]+/g, " ")
    .trim()
    .slice(0, 140)
}
const links = /https?:\/\/[^\s)]+/gi

function mediaDescriptions(event: Pick<Note, "tags">) {
  return [
    ...new Set(
      event.tags
        .slice(0, 64)
        .flatMap(([name, ...values]) => {
          if (name === "alt" || name === "title") return values.slice(0, 1)
          if (name === "imeta")
            return values.filter((v) => v.startsWith("alt ")).map((v) => v.slice(4))
          return []
        })
        .map((s) => s.slice(0, 240))
    ),
  ]
}

// Long Nostr pointers and tracking parameters can take up the model's entire
// 128-token window. Keep readable link slugs for notes that just share a link.
export function searchPostText(event: Pick<Note, "content" | "tags">) {
  const content = event.content
    .slice(0, 12000)
    .replace(references, " ")
    .replace(
      /<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\s*\/?>|&(?:#\d+|#x[\da-f]+|[a-z]{2,12});/gi,
      " "
    )
    .replace(links, readableLink)
  const present = new Set(
    Array.from(content.matchAll(/(?:^|\s)#([\p{L}\p{M}\p{N}_-]+)/gu), (m) =>
      m[1].toLowerCase()
    )
  )
  const parts = [content, ...mediaDescriptions(event)]
  for (const [key, value] of event.tags) {
    if (key !== "t" || !value || present.has(value.toLowerCase())) continue
    parts.push("#" + value)
    present.add(value.toLowerCase())
  }
  return parts.join(" ").trim().slice(0, 1800)
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
  const described = [
    event.content.slice(0, 12000).replace(links, readableLink),
    ...mediaDescriptions(event),
  ].join(" ")
  const tokens = words(described)
  if (!tokens.length && !tags.size) return -1
  if (tokens.length <= 12 && !plan.terms.every((t) => conversational.has(t))) {
    const body = words(described.replace(references, " "))
    if (!body.length && !tags.size && !plan.terms.some((t) => tokens.includes(t)))
      return -1
    const substance = body.filter((t) => !conversational.has(t))
    if (body.length && !substance.length) return -1
    if (
      substance.length === 1 &&
      body.some((t) => ["nice", "cool", "awesome", "interesting", "great"].includes(t)) &&
      (!plan.terms.includes(substance[0]) || plan.browse)
    )
      return -1
  }
  const available = new Set([...tokens, ...tags])
  const coverage =
    plan.terms.filter((term) => available.has(term)).length / plan.terms.length
  if (!coverage) return 0
  if (plan.browse && plan.terms.length === 1) return 0.55 * coverage
  const phrase = (" " + tokens.join(" ") + " ").includes(" " + plan.phrase + " ")
  return 0.9 * coverage + (phrase ? 0.1 : 0)
}

// Calibrate cosine similarity on short posts. Values near 0.2 were common
// for off-topic notes, while relevant paraphrases often scored around 0.4.
export function calibratedSimilarity(cosine: number) {
  return Math.min(1, Math.max(0, (cosine - 0.16) / 0.48))
}

// A close term in the post can corroborate a weaker whole-post embedding.
// Narrow questions still use their full meaning (e.g. coffee brewing vs beer).
export function semanticMatch(
  cosine: number,
  content: string,
  neighbors?: ReadonlyMap<string, number>,
  broadSubject?: string,
  intentCosine?: number
) {
  if (!neighbors?.size) return calibratedSimilarity(cosine)
  // A post about an aspect of a broad subject may never name the subject.
  // Two independent nearby words are stronger evidence than one stray match.
  const tokens = new Set(words(content))
  const evidence = Array.from(tokens, (t) => neighbors.get(t) ?? 0).sort((a, b) => b - a)
  const [first = 0, second = 0] = evidence
  // On long posts two incidental mentions can swamp the article's subject.
  // Require support across more of the text, capping the effect of synonyms.
  if (broadSubject && tokens.size >= 24) {
    const support =
      evidence.slice(0, 4).reduce((sum, n) => sum + Math.min(0.65, n), 0) / 4
    const meaning = 0.4 * cosine + 0.6 * (intentCosine ?? cosine)
    return calibratedSimilarity(Math.max(0.8 * cosine, 0.8 * support + 0.2 * meaning))
  }
  const nearby = 0.7 * first + 0.3 * second
  let match = Math.max(cosine, 0.8 * nearby + 0.14 * cosine)
  // A category name by itself (e.g. an afterparty at a tech conference)
  // can make the sentence look close even when the rest is off topic.
  if (broadSubject && tokens.has(broadSubject) && nearby < 0.48)
    match *= Math.max(0, 1 - (0.48 - nearby) / 0.48)
  return calibratedSimilarity(match)
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
  const topical =
    semantic === undefined
      ? 0.64 * lexical
      : Math.max(
          (0.25 + 0.23 * Math.min(1, semantic / 0.42)) * lexical,
          0.76 * semantic + 0.24 * lexical
        )
  const freshness = 1 / (1 + Math.max(0, ageDays) / 30)
  return topical * (0.8 + 0.13 * author + 0.07 * freshness)
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
