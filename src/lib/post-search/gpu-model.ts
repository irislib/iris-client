import {InferenceSession, Tensor, env} from "onnxruntime-web/jspi"
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jspi.wasm?url"
import moduleUrl from "onnxruntime-web/ort-wasm-simd-threaded.jspi.mjs?url"
import modelUrl from "./model/search-minilm-gpu.onnx?url"

export async function loadGpuModel() {
  const {gpu} = navigator as Navigator & {
    gpu: {
      requestAdapter(): Promise<{
        features: ReadonlySet<string>
        info: {isFallbackAdapter: boolean}
      } | null>
    }
  }
  const adapter = await gpu.requestAdapter()
  if (!adapter?.features.has("shader-f16") || adapter.info.isFallbackAdapter) return
  env.webgpu.adapter = adapter
  env.wasm.numThreads = 1
  env.wasm.wasmPaths = {wasm: wasmUrl, mjs: moduleUrl}
  const model = await InferenceSession.create(modelUrl, {executionProviders: ["webgpu"]})
  return {model, Tensor, batchSize: 4}
}
