// Reproduce the GPU weight file from the pinned MiniLM checkpoint and the shipped CPU model.
import {createHash} from "node:crypto"
import {readFile, writeFile} from "node:fs/promises"
import {createRequire} from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
const {onnx} = require(
  path.resolve(
    path.dirname(require.resolve("onnxruntime-web")),
    "../lib/onnxjs/ort-schema/protobuf/onnx.js"
  )
)
const base = new URL("../src/lib/post-search/model/", import.meta.url)
const upstream =
  "https://huggingface.co/Xenova/paraphrase-MiniLM-L3-v2/resolve/4b544e74dfc3256b2b56849ea5d7064fee1ac846/onnx/model_fp16.onnx"
const input = process.argv[2]
  ? await readFile(process.argv[2])
  : new Uint8Array(await (await fetch(upstream)).arrayBuffer())
if (
  createHash("sha256").update(input).digest("hex") !==
  "2c904f8c37c02c6c4fbec29d271736f50be8e64654f054cf38bd46c8a6429c30"
)
  throw Error("Unexpected MiniLM checkpoint")
const cpu = onnx.ModelProto.decode(await readFile(new URL("search-minilm-q8.onnx", base)))
const gpu = onnx.ModelProto.decode(input)
const table = "embeddings.word_embeddings.weight"
// Keep this 30,522-word table in its existing 8-bit format. Only the selected
// tokens are expanded, and the resulting single GPU asset fits the site's size limit.
const cpuGather = cpu.graph.node.find(
  (n) => n.opType === "Gather" && n.input[0] === table + "_quantized"
)
const dequantize = cpu.graph.node.find(
  (n) => n.opType === "DequantizeLinear" && n.input[0] === cpuGather.output[0]
)
const pos = gpu.graph.node.findIndex((n) => n.opType === "Gather" && n.input[0] === table)
const [gather] = gpu.graph.node.splice(pos, 1)
const decoded = gather.output[0] + "_float"
gpu.graph.initializer = gpu.graph.initializer.filter((t) => t.name !== table)
gpu.graph.initializer.push(
  ...cpu.graph.initializer.filter((t) => t.name.startsWith(table + "_"))
)
gpu.graph.node.splice(
  pos,
  0,
  cpuGather,
  {...dequantize, output: [decoded]},
  {
    opType: "Cast",
    input: [decoded],
    output: gather.output,
    attribute: [
      {
        name: "to",
        type: onnx.AttributeProto.AttributeType.INT,
        i: onnx.TensorProto.DataType.FLOAT16,
      },
    ],
  }
)
await writeFile(
  new URL("search-minilm-gpu.onnx", base),
  onnx.ModelProto.encode(gpu).finish()
)
