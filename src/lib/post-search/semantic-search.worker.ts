import {Tokenizer} from "@huggingface/tokenizers"
import {InferenceSession, env} from "onnxruntime-web/wasm"
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url"
import moduleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url"
import modelUrl from "./model/search-minilm-q8.onnx?url"
import tokenizerUrl from "./model/search-tokenizer.json?url"
import indexUrl from "./model/search-keywords.bin?url"
import config from "./model/tokenizer_config.json"
import {embed} from "./embeddings"
import type {FilterHints} from "./query"
import {prepareSemanticQuery, scoreSemanticPost, searchVocabulary} from "./vocabulary"
import {planPostSearch} from "./ranking"

env.wasm.numThreads = 1
env.wasm.wasmPaths = {wasm: wasmUrl, mjs: moduleUrl}
async function load() {
  const [response, model] = await Promise.all([
    fetch(tokenizerUrl),
    InferenceSession.create(modelUrl, {executionProviders: ["wasm"]}),
  ])
  if (!response.ok) throw Error("Tokenizer unavailable")
  const json = await response.json()
  return {
    model,
    tokenizer: new Tokenizer(json, config),
    words: searchVocabulary(json.model.vocab),
  }
}
let loaded: ReturnType<typeof load>
let index: Int8Array | undefined
let evidence:
  {query: string; selection: Awaited<ReturnType<typeof prepareSemanticQuery>>} | undefined
const vectors = new Map<string, Float32Array>()
async function vectorFor(text: string) {
  const cached = vectors.get(text)
  if (cached) return cached
  const {model, tokenizer} = await loaded
  const vector = await embed(model, tokenizer, text)
  if (vectors.size >= 256) vectors.delete(vectors.keys().next().value!)
  vectors.set(text, vector)
  return vector
}
interface SearchRequest {
  request: number
  query: string
  posts: string[]
  hints?: FilterHints
}

async function score({request, query, posts, hints}: SearchRequest) {
  try {
    const {words} = await (loaded ??= load())
    const plan = planPostSearch(query)
    const vector = await vectorFor(plan.modelQuery)
    if (!posts.length) {
      let terms: string[] = [],
        tags: string[] = []
      evidence = undefined
      // A missing optional keyword index must not disable post scoring.
      try {
        if (!index) {
          const response = await fetch(indexUrl)
          if (response.ok) index = new Int8Array(await response.arrayBuffer())
        }
        if (index) {
          // Relays keep returning notes while the model and index download.
          // Snapshot those candidates at planning time, including on a cold visit.
          if (!hints) {
            self.postMessage({request, needsHints: true})
            return
          }
          const selection = await prepareSemanticQuery(
            plan,
            words,
            index,
            vector,
            hints,
            vectorFor
          )
          terms = selection.terms
          tags = selection.tags
          evidence = {query, selection}
        }
      } catch {
        /* Primary words, hashtags and recent notes are already being searched. */
      }
      self.postMessage({request, scores: [], terms, tags})
      return
    }
    const scores: number[] = []
    for (const post of posts)
      scores.push(
        scoreSemanticPost(
          plan,
          vector,
          await vectorFor(post),
          post,
          evidence?.query === query ? evidence.selection : undefined
        )
      )
    self.postMessage({request, scores})
  } catch {
    self.postMessage({request, error: true})
  }
}

// ONNX uses one session. Finish a previous query's small outstanding batch
// before starting the next, even when its caller has already navigated away.
let pending = Promise.resolve()
self.onmessage = ({data}: MessageEvent<SearchRequest>) => {
  pending = pending.then(() => score(data))
}
