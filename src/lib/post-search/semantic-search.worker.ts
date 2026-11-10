import {Tokenizer} from "@huggingface/tokenizers"
import {InferenceSession, Tensor, env} from "onnxruntime-web/wasm"
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url"
import moduleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url"
import modelUrl from "./model/search-minilm-q8.onnx?url"
import tokenizerUrl from "./model/search-tokenizer.json?url"
import indexUrl from "./model/search-keywords.bin?url"
import config from "./model/tokenizer_config.json"
import {embedBatch} from "./embeddings"
import type {FilterHints} from "./query"
import {prepareSemanticQuery, scoreSemanticPost, searchVocabulary} from "./vocabulary"
import {planPostSearch} from "./ranking"

async function loadCpuModel() {
  env.wasm.numThreads = 1
  env.wasm.wasmPaths = {wasm: wasmUrl, mjs: moduleUrl}
  const model = await InferenceSession.create(modelUrl, {executionProviders: ["wasm"]})
  return {model, Tensor, batchSize: 1}
}

async function loadModel() {
  if ("gpu" in navigator && "Suspending" in WebAssembly) {
    try {
      const gpu = await (await import("./gpu-model")).loadGpuModel()
      if (gpu) return gpu
    } catch {
      // A disabled adapter or an unsupported driver can still use local CPU search.
    }
  }
  return loadCpuModel()
}

async function load() {
  const [response, runtime] = await Promise.all([fetch(tokenizerUrl), loadModel()])
  if (!response.ok) throw Error("Tokenizer unavailable")
  const json = await response.json()
  return {
    runtime,
    tokenizer: new Tokenizer(json, config),
    words: searchVocabulary(json.model.vocab),
  }
}
let loaded: ReturnType<typeof load>
let index: Int8Array | undefined
let evidence:
  {query: string; selection: Awaited<ReturnType<typeof prepareSemanticQuery>>} | undefined
// Embedding is the slow step. Keep the posts still being ranked or searched
// again: refining a query reuses them, and new arrivals must not evict them.
const vectors = new Map<string, Float32Array>()
function remembered(text: string) {
  const vector = vectors.get(text)
  if (vector) {
    vectors.delete(text)
    vectors.set(text, vector)
  }
  return vector
}
async function vectorsFor(texts: string[]) {
  const found = new Map(texts.map((text) => [text, remembered(text)]))
  const missing = [...found.keys()].filter((text) => !found.get(text))
  if (missing.length) {
    const state = await loaded
    const {model, batchSize, Tensor} = state.runtime
    for (let start = 0; start < missing.length; start += batchSize) {
      const batch = missing.slice(start, start + batchSize)
      const result = await embedBatch(model, state.tokenizer, batch, Tensor)
      batch.forEach((text, i) => {
        if (vectors.size >= 1024) vectors.delete(vectors.keys().next().value!)
        vectors.set(text, result[i])
        found.set(text, result[i])
      })
    }
  }
  return texts.map((text) => found.get(text)!)
}
async function vectorFor(text: string) {
  const [vector] = await vectorsFor([text])
  return vector
}
interface SearchRequest {
  request: number
  query: string
  posts: string[]
  hints?: FilterHints
}

async function score({request, query, posts, hints}: SearchRequest) {
  const {words, runtime} = await (loaded ??= load())
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
    self.postMessage({request, scores: [], terms, tags, batchSize: runtime.batchSize})
    return
  }
  const postVectors = await vectorsFor(posts)
  const scores = posts.map((post, i) =>
    scoreSemanticPost(
      plan,
      vector,
      postVectors[i],
      post,
      evidence?.query === query ? evidence.selection : undefined
    )
  )
  self.postMessage({request, scores, batchSize: runtime.batchSize})
}

async function handle(data: SearchRequest) {
  try {
    await score(data)
  } catch {
    // Retry the active request on CPU if a previously working GPU was lost.
    const state = await loaded?.catch(() => undefined)
    if (state && state.runtime.batchSize > 1) {
      try {
        await state.runtime.model.release().catch(() => {})
        vectors.clear()
        evidence = undefined
        state.runtime = await loadCpuModel()
        await score(data)
        return
      } catch {
        /* Report the failed request below. */
      }
    }
    self.postMessage({request: data.request, error: true})
  }
}

// ONNX uses one session. Finish a previous query's small outstanding batch
// before starting the next, even when its caller has already navigated away.
let pending = Promise.resolve()
self.onmessage = ({data}: MessageEvent<SearchRequest>) => {
  pending = pending.then(() => handle(data))
}
