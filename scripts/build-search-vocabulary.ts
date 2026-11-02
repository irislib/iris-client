import {writeFile} from "node:fs/promises"
import {embed} from "../src/lib/post-search/embeddings"
import {searchVocabulary} from "../src/lib/post-search/vocabulary"
import {loadPostSearchModel, modelDirectory} from "./post-search-model"
const {model, tokenizer, vocab} = await loadPostSearchModel()
const words = searchVocabulary(vocab)
const vectors: Int8Array[] = []
for (const word of words) {
  const vector = await embed(model, tokenizer, word)
  const scale = 127 / Math.max(...vector.map(Math.abs))
  vectors.push(Int8Array.from(vector, (v) => Math.round(v * scale)))
}
await writeFile(
  new URL("search-keywords.bin", modelDirectory),
  Buffer.concat(vectors.map((v) => Buffer.from(v.buffer)))
)
await model.release()
console.log("Indexed", words.length, "relay search terms")
