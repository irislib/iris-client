import type {Tokenizer} from "@huggingface/tokenizers"
import {InferenceSession, Tensor} from "onnxruntime-web/wasm"

export async function embed(model: InferenceSession, tokenizer: Tokenizer, text: string) {
  const [vector] = await embedBatch(model, tokenizer, [text])
  return vector
}

export async function embedBatch(
  model: InferenceSession,
  tokenizer: Tokenizer,
  texts: string[],
  TensorClass = Tensor
) {
  if (!texts.length) return []
  const rows = texts.map((text) => {
    const {ids} = tokenizer.encode(text)
    // Keep the final separator at the model's 128-token limit.
    if (ids.length > 128) ids.splice(127, ids.length - 128)
    return ids
  })
  const width = Math.max(...rows.map((row) => row.length))
  const ids = new BigInt64Array(rows.length * width)
  const mask = new BigInt64Array(ids.length)
  rows.forEach((row, i) => {
    ids.set(BigInt64Array.from(row, BigInt), i * width)
    mask.fill(1n, i * width, i * width + row.length)
  })
  const dims = [rows.length, width]
  const inputs = {
    input_ids: new TensorClass("int64", ids, dims),
    attention_mask: new TensorClass("int64", mask, dims),
    token_type_ids: new TensorClass("int64", new BigInt64Array(ids.length), dims),
  }
  try {
    const outputs = await model.run(inputs)
    try {
      const hidden = outputs.last_hidden_state
      const size = hidden.dims[2]
      return rows.map((row, i) => {
        const pooled = new Float32Array(size)
        const offset = i * width * size
        for (let j = 0; j < row.length * size; j++)
          pooled[j % size] += Number(hidden.data[offset + j])
        const norm = Math.hypot(...pooled)
        return pooled.map((x) => x / norm)
      })
    } finally {
      Object.values(outputs).forEach((x) => x.dispose())
    }
  } finally {
    Object.values(inputs).forEach((x) => x.dispose())
  }
}

export function similarity(a: Float32Array, b: Float32Array) {
  return Math.max(
    0,
    Math.min(
      1,
      a.reduce((sum, v, i) => sum + v * b[i], 0)
    )
  )
}
