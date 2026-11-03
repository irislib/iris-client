// Compare optional local providers with the same production prompts, model
// projections and blended ranking. Input is a JSON array of synthetic cases.
import {readFile} from "node:fs/promises"
import {createPostScorer} from "../src/lib/post-search/scorer"
import {
  planPostSearch,
  lexicalMatch,
  rankCandidates,
  searchPostText,
} from "../src/lib/post-search/ranking"
import {embed} from "../src/lib/post-search/embeddings"
import {
  prepareSemanticQuery,
  scoreSemanticPost,
  searchVocabulary,
} from "../src/lib/post-search/vocabulary"
import {loadPostSearchModel, modelDirectory} from "./post-search-model"

const [source, provider] = process.argv.slice(2)
if (!source || !provider)
  throw Error(
    "Pass a case JSON file and minilm, minilm-original or a local Ollama model name."
  )
const cases: {query: string; knownTags: string[]; posts: string[]}[] = JSON.parse(
  await readFile(source, "utf8")
)
const tuned = provider !== "minilm-original"
const device =
  provider === "minilm" || provider === "minilm-original"
    ? await loadPostSearchModel()
    : undefined
const vocabulary = device && searchVocabulary(device.vocab)
const index =
  device && new Int8Array(await readFile(new URL("search-keywords.bin", modelDirectory)))
try {
  for (const {query, knownTags, posts} of cases) {
    const plan = planPostSearch(query)
    const hints = {tags: knownTags, observed: []}
    const events = posts.map((content, i) => ({
      content,
      id: String(i),
      pubkey: String(i),
      tags: [],
      created_at: 0,
    }))
    const texts = events.map(searchPostText)
    let terms: string[] = [],
      tags: string[] = [],
      scores: number[]
    if (device && vocabulary && index) {
      const vector = (text: string) => embed(device.model, device.tokenizer, text)
      const queryVector = await vector(plan.modelQuery)
      const selection = await prepareSemanticQuery(
        plan,
        vocabulary,
        index,
        queryVector,
        hints,
        vector,
        tuned
      )
      terms = selection.terms
      tags = selection.tags
      scores = []
      for (const text of texts) {
        scores.push(
          scoreSemanticPost(plan, queryVector, await vector(text), text, selection)
        )
      }
    } else {
      const controller = new AbortController()
      try {
        const score = createPostScorer(
          {model: "ollama", ollamaModel: provider},
          query,
          controller.signal,
          (newTerms, newTags) => {
            terms = newTerms
            tags = newTags ?? []
          },
          () => {
            throw Error("Unexpected fallback")
          },
          async () => hints
        )
        await score([])
        scores = await score(texts)
      } finally {
        controller.abort()
      }
    }
    const ranked = rankCandidates(
      events.map((event) => ({event, lexical: lexicalMatch(plan, event), author: 0})),
      new Map(events.map((event, i) => [event.id, scores[i]])),
      0
    )
    process.stdout.write(
      JSON.stringify({
        query,
        terms,
        tags,
        scores,
        ranked: ranked.primary.map((event) => Number(event.id)),
      }) + "\n"
    )
  }
} finally {
  await device?.model.release()
}
