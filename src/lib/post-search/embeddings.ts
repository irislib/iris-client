import type {Tokenizer} from "@huggingface/tokenizers"
import {InferenceSession, Tensor} from "onnxruntime-web/wasm"

export async function embed(model: InferenceSession, tokenizer: Tokenizer, text: string) {
  const {ids} = tokenizer.encode(text)
  // The model was trained with a 128-token sequence limit.
  if (ids.length > 128) ids.splice(127, ids.length - 128)
  const dims = [1, ids.length]
  const inputs = {
    input_ids: new Tensor("int64", BigInt64Array.from(ids, BigInt), dims),
    attention_mask: new Tensor("int64", new BigInt64Array(ids.length).fill(1n), dims),
    token_type_ids: new Tensor("int64", new BigInt64Array(ids.length), dims),
  }
  try {
    const outputs = await model.run(inputs)
    try {
      const hidden = outputs.last_hidden_state
      const pooled = new Float32Array(hidden.dims[2])
      for (let i = 0; i < hidden.data.length; i++)
        pooled[i % pooled.length] += Number(hidden.data[i])
      const norm = Math.hypot(...pooled)
      return pooled.map((x) => x / norm)
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
