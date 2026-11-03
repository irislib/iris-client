import {words as tokenize, stopWords, type FilterHints, type SearchPlan} from "./query"
import {similarity} from "./embeddings"
import tagWeights from "./model/search-tag-head.json"
import {semanticMatch} from "./ranking"

// Use whole words from the pinned tokenizer, supplemented with network terminology
// absent from its older vocabulary. The index contains no users or search history.
export function searchVocabulary(vocab: Record<string, number>) {
  const words = Object.keys(vocab)
    .filter((t) => /^[a-z]{3,18}$/.test(t))
    .sort((a, b) => vocab[a] - vocab[b])
    .slice(0, 9000)
  return [
    ...new Set([
      ...words,
      ..."nostr bitcoin lightning sats satoshi ecash cashu wallet relay relays zap zaps pubkey selfhosted privacy encryption nip05 nsec npub lnbc lightningnetwork nostrconnect decentralized".split(
        " "
      ),
    ]),
  ]
}

function sameWordFamily(a: string, b: string) {
  if (a === b) return true
  if (a.includes(" ") || b.includes(" ")) return false
  const short = a.length <= b.length ? a : b
  const long = a.length <= b.length ? b : a
  // Skip fragments (lap/laptop) and close inflections (technology/technologies).
  if (short.length >= 3 && long.startsWith(short) && long.length - short.length <= 3)
    return true
  return (
    short.length >= 6 &&
    long.length - short.length <= 3 &&
    long.startsWith(short.slice(0, -2))
  )
}

// The dictionary is a cheap source of word embeddings. Observed post language
// favors filters a relay can actually match. Unknown hashtags are open vocabulary.
export function selectKeywordFilters(
  words: string[],
  index: Int8Array,
  query: Float32Array,
  exclude: ReadonlySet<string>,
  hints?: FilterHints
) {
  if (index.length !== words.length * query.length) throw Error("Invalid keyword index")
  const seenTags = new Set(hints?.tags.map((t) => t.toLowerCase()))
  const neighbors = new Map<string, number>()
  const candidates: {word: string; score: number; offset: number}[] = []
  for (let i = 0; i < words.length; i++) {
    const offset = i * query.length
    let dot = 0,
      squared = 0
    for (let j = 0; j < query.length; j++) {
      const v = index[offset + j]
      dot += v * query[j]
      squared += v * v
    }
    const word = words[i],
      score = dot / Math.sqrt(squared)
    if (score >= 0.32 && !stopWords.has(word) && !exclude.has(word))
      neighbors.set(word, score)
  }
  // Prefer a filter that occurs alongside other topical words. Incidental
  // words in an unrelated post should get no benefit merely for being seen.
  const support = new Map<string, number>()
  for (const sample of hints?.observed ?? []) {
    const ranked = sample
      .map((word) => ({
        word,
        score: exclude.has(word) ? 0.7 : (neighbors.get(word) ?? 0),
      }))
      .sort((a, b) => b.score - a.score)
    for (const {word} of ranked) {
      const other = (ranked[0]?.word === word ? ranked[1] : ranked[0])?.score ?? 0
      support.set(word, Math.max(support.get(word) ?? 0, other))
    }
  }
  for (const [i, word] of words.entries()) {
    const affinity = neighbors.get(word) ?? 0
    if (affinity < 0.41) continue
    if (affinity < 0.52 && (support.get(word) ?? 0) < 0.42 && !seenTags.has(word))
      continue
    const evidence = Math.max(0, (support.get(word) ?? 0) - 0.35)
    candidates.push({
      word,
      offset: i * query.length,
      // Frequent tokenizer words are often poor standalone relay searches.
      score:
        affinity +
        0.08 * Math.sqrt(i / words.length) +
        0.3 * evidence +
        (seenTags.has(word) ? 0.08 : 0),
    })
  }
  candidates.sort((a, b) => b.score - a.score)
  const families = [...exclude]
  const options = candidates.filter(
    (c) => !families.some((w) => sameWordFamily(w, c.word))
  )
  const first = options[0]
  const rest = first ? options.filter((c) => !sameWordFamily(first.word, c.word)) : []
  // A tag often co-occurs with unrelated subjects (e.g. general news). Give
  // observed words priority only within a comparable semantic neighborhood.
  const minimumAffinity = 0.75 * (neighbors.get(first?.word ?? "") ?? 0)
  const grounded = (c: {word: string}) =>
    (neighbors.get(c.word) ?? 0) >= minimumAffinity &&
    ((support.get(c.word) ?? 0) >= 0.42 || seenTags.has(c.word))
  let second = rest.find(grounded)
  if (!second && first) {
    // On a fresh device, spend the second request on a different, still-close
    // direction in the embedding space. Near-duplicate spellings add little.
    let best = -Infinity
    for (const option of rest.slice(0, 24)) {
      if (option.score < Math.max(0.52, first.score - 0.27)) break
      let dot = 0,
        normA = 0,
        normB = 0
      for (let j = 0; j < query.length; j++) {
        const a = index[first.offset + j],
          b = index[option.offset + j]
        dot += a * b
        normA += a * a
        normB += b * b
      }
      const utility = option.score - (0.35 * dot) / Math.sqrt(normA * normB)
      if (utility > best) {
        best = utility
        second = option
      }
    }
  }
  const terms = [first, second].flatMap((c) => (c ? [c.word] : []))
  // A relevant attested word is a better context for a short, broad subject
  // than repeatedly embedding variations of the user's question.
  const context = candidates
    .filter(grounded)
    .filter((c) => !exclude.has(c.word))
    .slice(0, 4)
    .map((c) => c.word)
  return {terms, neighbors, context}
}

export function planModelFilters(
  plan: SearchPlan,
  words: string[],
  index: Int8Array,
  query: Float32Array,
  hints?: FilterHints
) {
  const searched = [plan.relayQuery, ...plan.anchors, ...plan.hashtags, ...plan.terms]
  return selectKeywordFilters(
    words,
    index,
    query,
    new Set(searched.map((t) => t.toLowerCase())),
    hints
  )
}

// Preserve the on-wire tag spelling. Score unfamiliar compounds with the
// same small model, but bound cold inference even for a large tag catalogue.
export async function selectKnownTags(
  tags: string[],
  plan: SearchPlan,
  neighbors: ReadonlyMap<string, number>,
  vector: Float32Array,
  vectorFor: (text: string) => Promise<Float32Array>,
  allowLearnedFallback = false
) {
  const candidates = tags
    .map((tag) => {
      const label = tokenize(
        tag.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ")
      ).join(" ")
      const parts = label.split(" ")
      const estimate = Math.max(
        0,
        ...parts.map((t) => (plan.terms.includes(t) ? 1 : (neighbors.get(t) ?? 0)))
      )
      return {tag, label, estimate}
    })
    .sort((a, b) => b.estimate - a.estimate)
  let budget = 8
  const found: {tag: string; score: number}[] = []
  let fallback: {tag: string; score: number} | undefined
  for (const {tag, label, estimate} of candidates) {
    if (plan.terms.includes(tag) || plan.hashtags.includes(tag)) continue
    let score = neighbors.get(label)
    if (score === undefined && budget > 0) {
      budget--
      const candidate = await vectorFor(label)
      score = candidate.reduce((sum, v, i) => sum + v * vector[i], 0)
      if (allowLearnedFallback && tagWeights.length === candidate.length + 2) {
        // Reuse this probe. Multi-word searches with no expansion can spend
        // one existing filter on an observed tag, retaining the exact spelling.
        const logit = candidate.reduce(
          (n, v, i) => n + v * tagWeights[i + 2],
          tagWeights[0] + tagWeights[1] * Math.max(0, score)
        )
        const probability = 1 / (1 + Math.exp(-logit))
        const priority = probability + 0.04 * estimate
        if (probability >= 0.45 && (!fallback || priority > fallback.score))
          fallback = {tag, score: priority}
      }
    }
    if ((score ?? 0) >= 0.45) found.push({tag, score: score! + 0.04 * estimate})
  }
  if (!found.length && fallback) return [fallback.tag]
  return found
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((c) => c.tag)
}

export async function prepareSemanticQuery(
  plan: SearchPlan,
  words: string[],
  index: Int8Array,
  query: Float32Array,
  hints: FilterHints | undefined,
  vectorFor: (text: string) => Promise<Float32Array>,
  useTagHead = true
) {
  const selected = planModelFilters(plan, words, index, query, hints)
  const tags = await selectKnownTags(
    hints?.tags ?? [],
    plan,
    selected.neighbors,
    query,
    vectorFor,
    useTagHead && plan.terms.length > 1 && !selected.terms.length
  )
  const context =
    plan.browse && plan.terms.length === 1 && selected.context.length
      ? await vectorFor([plan.modelQuery, ...selected.context].join(", "))
      : undefined
  const intent =
    plan.browse && plan.terms.length === 1 ? await vectorFor(plan.text) : undefined
  return {terms: selected.terms, tags, context, intent, neighbors: selected.neighbors}
}

export function scoreSemanticPost(
  plan: SearchPlan,
  query: Float32Array,
  vector: Float32Array,
  text: string,
  selected?: Awaited<ReturnType<typeof prepareSemanticQuery>>
) {
  const cosine = Math.max(
    similarity(query, vector),
    selected?.context ? 0.85 * similarity(selected.context, vector) : 0
  )
  return semanticMatch(
    cosine,
    text,
    plan.terms.length === 1 ? selected?.neighbors : undefined,
    plan.browse && plan.terms.length === 1 ? plan.terms[0] : undefined,
    selected?.intent ? similarity(selected.intent, vector) : undefined
  )
}
