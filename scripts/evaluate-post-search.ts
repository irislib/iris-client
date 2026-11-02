// Offline relevance check. Uses the same tokenizer, CPU weights and scoring functions as the worker.
import {readFile} from "node:fs/promises"
import {embed, similarity} from "../src/lib/post-search/embeddings"
import {
  authorSignal,
  lexicalMatch,
  planPostSearch,
  postRelevance,
  calibratedSimilarity,
} from "../src/lib/post-search/ranking"
import {searchVocabulary, relatedKeywords} from "../src/lib/post-search/vocabulary"
import {createPostSearchMatcher} from "../src/shared/hooks/postSearch"
import {loadPostSearchModel, modelDirectory} from "./post-search-model"

const posts = [
  "Fix a bicycle puncture by taking out the inner tube, finding the leak and gluing a patch over it.",
  "I watched a bicycle race this morning. What a sprint finish!",
  "Our new Lightning wallet sends and receives bitcoin payments even for a single satoshi.",
  "Lightning lit up the sky last night. Thunder shook the house.",
  "Cold fermentation gives homemade sourdough a blistered crust. Leave the dough in the fridge overnight.",
  "The bakery's new logo is a drawing of sourdough bread.",
  "Restore deleted files from an encrypted backup before replacing the failed hard drive.",
  "The band played a backup show after their tour bus broke down.",
  "Tall buildings block the signal. Download offline maps before losing cell service on a hike.",
  "Hiking boots for sale. Nearly new, waterproof soles.",
  "Drape an old sheet over tomato seedlings before a frost. Remove it when the sun comes up.",
  "I made tomato soup and froze the leftovers.",
  "Turn off background app refresh and dim your phone screen to extend battery life.",
  "My phone wallpaper is a photo of a battery factory.",
  "A Nostr relay stores signed events and sends them to subscribers whose filters match.",
  "The relay team won gold with a perfectly timed baton exchange.",
  "Rinse the coffee filter, grind the beans medium-fine and pour hot water slowly over the grounds.",
  "Meet me for coffee after the concert.",
  "Acoustic panels and thick curtains absorb reflections and reduce echo in a recording room.",
  "Echo is the name of our new puppy.",
]
const evaluation = [
  ["tuning", "puncture", 0],
  ["tuning", "lightning payments", 2],
  ["tuning", "how do I bake a loaf with a crisp crust", 4],
  ["tuning", "a post about recovering lost data from a broken disk", 6],
  ["tuning", "how can I navigate trails without reception", 8],
  ["held-out", "frost", 10],
  ["held-out", "make my smartphone last longer between charges", 12],
  ["held-out", "what do servers do with signed nostr messages", 14],
  ["held-out", "coffee brewing", 16],
  ["held-out", "how to stop sound bouncing around my studio", 18],
] as const
const {tokenizer, model, vocab} = await loadPostSearchModel()
const keywords = searchVocabulary(vocab),
  index = new Int8Array(await readFile(new URL("search-keywords.bin", modelDirectory)))
const embeddings = await Promise.all(posts.map((p) => embed(model, tokenizer, p)))
let failed = false
for (const split of ["tuning", "held-out"]) {
  const totals = [0, 0, 0]
  for (const [set, query, target] of evaluation.filter(([set]) => set === split)) {
    const plan = planPostSearch(query),
      literal = createPostSearchMatcher(query)
    const queryVector = await embed(model, tokenizer, query)
    const rows = posts.map((content, id) => {
      // The topical near-miss is newer and from a closer author than the best answer.
      const days = id % 2 ? 2 : 42,
        author = authorSignal(id % 2 ? 1 : 3, id % 2 ? 32 : 2)
      const post = {
        id: String(id),
        pubkey: String(id),
        content,
        created_at: 0,
        tags: [],
      }
      const lex = lexicalMatch(plan, post),
        ai = calibratedSimilarity(similarity(embeddings[id], queryVector))
      return {
        id,
        ai,
        lex,
        values: [
          literal(post) ? -days : -Infinity,
          postRelevance(lex, undefined, author, days),
          postRelevance(lex, ai, author, days),
        ],
      }
    })
    const ranks = totals.map(
      (_, mode) =>
        rows
          .filter((row) => Number.isFinite(row.values[mode]))
          .sort((a, b) => b.values[mode] - a.values[mode])
          .findIndex((row) => row.id === target) + 1
    )
    ranks.forEach((rank, i) => {
      if (rank) totals[i] += 1 / rank
    })
    console.log(
      set,
      query,
      JSON.stringify({
        ranks,
        expansion: relatedKeywords(keywords, index, queryVector, new Set(plan.terms)),
        match: rows[target].ai.toFixed(3),
        nearMiss: rows[target + 1].ai.toFixed(3),
      })
    )
  }
  console.log(
    split,
    "MRR (literal, text + network, blended):",
    totals.map((total) => (total / 5).toFixed(3)).join(" / ")
  )
  if (totals[2] <= totals[0]) failed = true
}
await model.release()
if (failed) process.exitCode = 1
