import {describe, expect, it, vi} from "vitest"
import type {Tokenizer} from "@huggingface/tokenizers"
import {Tensor, type InferenceSession} from "onnxruntime-web/wasm"
import {embedBatch} from "./embeddings"

describe("MiniLM batch pooling", () => {
  it("pads independently, preserves the last separator and excludes padding from each vector", async () => {
    const tokenizer = {
      encode: (text: string) => ({
        ids: text === "short" ? [101, 7, 102] : [101, ...Array(129).fill(8), 102],
      }),
    } as Tokenizer
    const run = vi.fn(async (input: Record<string, Tensor>) => {
      expect(input.input_ids.dims).toEqual([2, 128])
      expect(input.input_ids.data[127]).toBe(0n)
      expect(input.input_ids.data[255]).toBe(102n)
      expect(Array.from(input.attention_mask.data as BigInt64Array)).toEqual([
        ...Array(3).fill(1n),
        ...Array(125).fill(0n),
        ...Array(128).fill(1n),
      ])
      const states = new Float32Array(2 * 128 * 2)
      for (let token = 0; token < 256; token++) {
        // Deliberately give padding a large hidden state.
        states.set(token < 3 ? [1, 0] : token < 128 ? [0, 100] : [0, 1], token * 2)
      }
      return {last_hidden_state: new Tensor("float32", states, [2, 128, 2])}
    })
    const vectors = await embedBatch({run} as unknown as InferenceSession, tokenizer, [
      "short",
      "long",
    ])
    expect(run).toHaveBeenCalledTimes(1)
    expect(vectors.map((vector) => Array.from(vector))).toEqual([
      [1, 0],
      [0, 1],
    ])
  })
})
