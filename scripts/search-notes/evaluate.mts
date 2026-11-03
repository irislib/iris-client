// Replay the production planner and ranker on frozen public-note splits. Only
// case keys, filter choices, counts and metrics are written to the local log.
import {readFile} from "node:fs/promises"
import {resolve} from "node:path"
import {loadPostSearchModel, modelDirectory} from "../post-search-model"
import {embed} from "../../src/lib/post-search/embeddings"
import {planPostSearch, words} from "../../src/lib/post-search/query"
import {lexicalMatch, rankCandidates} from "../../src/lib/post-search/ranking"
import {
  prepareSemanticQuery,
  scoreSemanticPost,
  searchVocabulary,
} from "../../src/lib/post-search/vocabulary"

const [directory, split, mode, suite] = process.argv.slice(2)
if (!["valid", "test"].includes(split) || !["incumbent", "trained"].includes(mode))
  throw Error("Choose a split and model")
const tuned = mode === "trained"
const lines = async (file: string) =>
  (await readFile(resolve(directory, file), "utf8"))
    .trimEnd()
    .split("\n")
    .map((row) => JSON.parse(row))
interface Note {
  id: string
  author: string
  text: string
  tags: string[]
}
const notes = (await lines(split + ".jsonl")) as Note[]
const byId = new Map(notes.map((n) => [n.id, n]))
interface Case {
  query: string
  anchor: string
  tag: string
  knownTags: string[]
  ids: string[]
  grades: number[]
}
const cases: Case[] = []
if (suite === "blind") {
  const groups = new Map<string, {id: string; grade: number}[]>()
  for (const r of await lines("blind-judgments.jsonl"))
    groups.set(r.query, [...(groups.get(r.query) ?? []), r])
  const judged = new Set([...groups.values()].flat().map((r) => r.id))
  for (const [query, rows] of groups) {
    const terms = planPostSearch(query).terms
    const observed = notes
      .filter((n) => !judged.has(n.id))
      .map((n) => ({n, cover: terms.filter((t) => words(n.text).includes(t)).length}))
      .filter((x) => x.cover > 0)
      .sort((a, b) => b.cover - a.cover || a.n.id.localeCompare(b.n.id))
      .slice(0, 48)
    const tags = [...new Set(observed.flatMap((r) => r.n.tags))].slice(0, 128)
    cases.push({
      query,
      anchor: "",
      tag: "",
      knownTags: tags,
      ids: rows.map((r) => r.id),
      grades: rows.map((r) => r.grade),
    })
  }
} else cases.push(...(await lines("pairs-" + split + ".jsonl")))
const cached = process.argv[6] ?? directory
const order = JSON.parse(
  await readFile(resolve(cached, "vectors.json"), "utf8")
) as string[]
const buffer = await readFile(resolve(cached, "vectors.f32"))
if (buffer.length !== order.length * 384 * 4) throw Error("Incomplete frozen vectors")
const storage = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4)
const cache = new Map(order.map((s, i) => [s, storage.subarray(i * 384, (i + 1) * 384)]))
const {model, tokenizer, vocab} = await loadPostSearchModel()
const vec = async (s: string) => {
  if (!cache.has(s)) cache.set(s, await embed(model, tokenizer, s))
  return cache.get(s)!
}
const vocabulary = searchVocabulary(vocab),
  index = new Int8Array(await readFile(new URL("search-keywords.bin", modelDirectory)))
const tokenized = new Map(notes.map((n) => [n.id, " " + words(n.text).join(" ") + " "]))
try {
  for (const [i, row] of cases.entries()) {
    const plan = planPostSearch(row.query)
    const q = await vec(plan.modelQuery)
    const sel = await prepareSemanticQuery(
      plan,
      vocabulary,
      index,
      q,
      {tags: row.knownTags, observed: []},
      vec,
      tuned
    )
    const tested = row.ids.map((id) => byId.get(id)!)
    const events = tested.map((n) => ({
      id: n.id,
      pubkey: n.author,
      content: n.text,
      tags: [],
      created_at: 0,
    }))
    const scores = new Map<string, number>()
    for (const n of tested)
      scores.set(n.id, scoreSemanticPost(plan, q, await vec(n.text), n.text, sel))
    const ranked = rankCandidates(
      events.map((event) => ({event, lexical: lexicalMatch(plan, event), author: 0})),
      scores,
      0
    ).primary.map((x) => x.id)
    const relevant =
      suite === "blind"
        ? new Set(row.ids.filter((_, k) => row.grades[k] === 2))
        : new Set(
            notes
              .filter(
                (n) =>
                  n.author !== byId.get(row.anchor)!.author &&
                  n.tags.some((t) => t.toLowerCase() === row.tag.toLowerCase())
              )
              .map((n) => n.id)
          )
    const selectedTags = new Set([
      ...sel.tags,
      ...sel.terms.map((t) => t.replace(/\s+/g, "")),
    ])
    const queries = sel.terms.map((t) => " " + words(t).join(" ") + " ")
    let hits = 0,
      matched = 0
    for (const n of suite === "blind" ? tested : notes) {
      if (row.anchor && n.author === byId.get(row.anchor)!.author) continue
      if (
        !n.tags.some((t) => selectedTags.has(t)) &&
        !queries.some((t) => tokenized.get(n.id)!.includes(t))
      )
        continue
      matched++
      if (relevant.has(n.id)) hits++
    }
    const gains = ranked.map((id) => row.grades[row.ids.indexOf(id)])
    const dcg = (xs: number[]) =>
      xs.reduce((sum, v, j) => sum + (2 ** v - 1) / Math.log2(j + 2), 0)
    const ideal = dcg([...row.grades].sort((a, b) => b - a))
    const cutoff = suite === "blind" ? 2 : 1
    const pairs = row.ids.flatMap((id, a) =>
      row.ids
        .filter((_, b) => row.grades[a] > row.grades[b])
        .map((other) => {
          const delta = scores.get(id)! - scores.get(other)!
          return delta > 0 ? 1 : delta < 0 ? 0 : 0.5
        })
    )
    process.stdout.write(
      JSON.stringify({
        case: i,
        tag: row.tag,
        terms: sel.terms,
        tags: sel.tags,
        hits,
        matched,
        relevant: relevant.size,
        f1: matched + relevant.size ? (2 * hits) / (matched + relevant.size) : 0,
        ndcg: ideal ? dcg(gains) / ideal : 0,
        p1: Number((gains[0] ?? 0) >= cutoff),
        pairwise: pairs.length
          ? pairs.reduce<number>((a, b) => a + b, 0) / pairs.length
          : null,
      }) + "\n"
    )
  }
} finally {
  await model.release()
}
