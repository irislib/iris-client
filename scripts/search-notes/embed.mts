// Local batch embedding for the frozen production encoder and tokenizer.
import {readFile, open, writeFile} from "node:fs/promises"
import {resolve} from "node:path"
import {embed} from "../../src/lib/post-search/embeddings"
import {words} from "../../src/lib/post-search/query"
import {loadPostSearchModel} from "../post-search-model"

const directory = process.argv[2]
const texts = new Set<string>()
for (const split of ["train", "valid", "test"]) {
  const file = await readFile(resolve(directory, split + ".jsonl"), "utf8")
  for (const line of file.trimEnd().split("\n")) {
    const row: {text: string; tags: string[]} = JSON.parse(line)
    texts.add(row.text)
    for (const tag of row.tags)
      texts.add(
        words(tag.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ")).join(" ")
      )
  }
}
const order = [...texts].sort()
const {model, tokenizer} = await loadPostSearchModel()
const output = await open(resolve(directory, "vectors.f32"), "wx")
try {
  let i = 0
  for (const text of order) {
    const v = await embed(model, tokenizer, text)
    await output.write(v)
    if (++i % 5000 === 0) process.stderr.write(`Embedded ${i}/${order.length}\n`)
  }
  await writeFile(resolve(directory, "vectors.json"), JSON.stringify(order), {
    flag: "wx",
  })
} finally {
  await output.close()
  await model.release()
}
