import {mkdtemp, readFile, rename, rm, writeFile} from "node:fs/promises"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {DEFAULT_GRAPH_SNAPSHOT} from "nostr-social-graph/hashtreeSnapshot"
import {
  readMobileGraphSnapshot,
  verifyMobileGraphSnapshot,
} from "nostr-social-graph/mobileGraphSnapshot"

const assetDir = fileURLToPath(new URL("../src/assets/", import.meta.url))
const binary = join(assetDir, "socialGraph.bin")
const metadata = join(assetDir, "socialGraph.json")
const root = "336f319763657d6b0e65a5b5876719e8c8dcdcf9396852be71ee26b73368b29b"

async function main() {
  const [mode = "--verify", ...extra] = process.argv.slice(2)
  if (extra.length || !["--verify", "--refresh"].includes(mode))
    throw new Error("Expected --verify or --refresh")
  const priorReceipt = JSON.parse(await readFile(metadata, "utf8"))
  await verifyMobileGraphSnapshot(await readFile(binary), priorReceipt)
  if (mode === "--refresh") {
    const {bytes, receipt} = await readMobileGraphSnapshot(root, {
      signal: AbortSignal.timeout(60000),
      minUsers: Math.max(10_000, Math.ceil(priorReceipt.users / 2)),
    })
    const stage = await mkdtemp(join(assetDir, ".social-graph-"))
    try {
      await writeFile(join(stage, "socialGraph.bin"), bytes)
      await writeFile(
        join(stage, "socialGraph.json"),
        JSON.stringify(receipt, null, 2) + "\n"
      )
      await rename(join(stage, "socialGraph.bin"), binary)
      await rename(join(stage, "socialGraph.json"), metadata)
    } finally {
      await rm(stage, {recursive: true, force: true})
    }
  }
  const receipt = JSON.parse(await readFile(metadata, "utf8"))
  if (
    receipt.root !== root ||
    receipt.source?.publisher !== DEFAULT_GRAPH_SNAPSHOT.publisher ||
    receipt.source?.treeName !== DEFAULT_GRAPH_SNAPSHOT.treeName
  ) {
    throw new Error("Unexpected bundled discovery root or signed source")
  }
  await verifyMobileGraphSnapshot(await readFile(binary), receipt)
  console.log(
    `Verified signed discovery snapshot: ${receipt.users} users, ${receipt.bytes} bytes`
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
