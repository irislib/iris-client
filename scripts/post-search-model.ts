// Shared offline loader for the search evaluation and vocabulary build.
import {readFile} from "node:fs/promises"
import {fileURLToPath} from "node:url"
import {Tokenizer} from "@huggingface/tokenizers"
import {InferenceSession, env} from "onnxruntime-web/wasm"
export const modelDirectory = new URL("../src/lib/post-search/model/", import.meta.url)
export async function loadPostSearchModel() {
  const tokenizerJson = JSON.parse(
    await readFile(new URL("search-tokenizer.json", modelDirectory), "utf8")
  )
  const config = JSON.parse(
    await readFile(new URL("tokenizer_config.json", modelDirectory), "utf8")
  )
  env.wasm.numThreads = 1
  env.wasm.wasmBinary = new Uint8Array(
    await readFile(
      fileURLToPath(import.meta.resolve("onnxruntime-web/ort-wasm-simd-threaded.wasm"))
    )
  )
  const model = await InferenceSession.create(
    new Uint8Array(await readFile(new URL("search-minilm-q8.onnx", modelDirectory))),
    {executionProviders: ["wasm"]}
  )
  return {
    model,
    tokenizer: new Tokenizer(tokenizerJson, config),
    vocab: tokenizerJson.model.vocab,
  }
}
