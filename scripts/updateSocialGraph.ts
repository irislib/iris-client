import {createHash} from "node:crypto"
import {readFile, writeFile} from "node:fs/promises"
import {SocialGraph} from "nostr-social-graph"
import manifest from "../src/assets/socialGraph.json"
import {projectSocialGraph} from "./projectSocialGraph"

const asset = new URL("../src/assets/socialGraph.bin", import.meta.url)
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex")

async function verify(data: Uint8Array) {
  if (data.length !== manifest.bytes || sha256(data) !== manifest.sha256) {
    throw new Error("Bundled social graph does not match its reviewed checksum")
  }
  const graph = await SocialGraph.fromBinary(manifest.root, data)
  const size = graph.size()
  if (
    graph.getFollowedByUser(manifest.root).size !== manifest.directFollows ||
    size.users !== manifest.users ||
    size.follows !== manifest.follows ||
    size.mutes !== manifest.mutes ||
    size.sizeByDistance[2] !== manifest.secondDegree
  ) {
    throw new Error("Bundled social graph is missing the expected company network")
  }
}

async function main() {
  const [mode = "--verify", input, ...extra] = process.argv.slice(2)
  if (
    extra.length ||
    !["--verify", "--refresh"].includes(mode) ||
    (mode === "--verify" && input)
  ) {
    throw new Error("Usage: updateSocialGraph.ts [--verify | --refresh [source.bin]]")
  }
  if (mode === "--refresh") {
    let projected: Uint8Array
    if (input) {
      const source = new Uint8Array(await readFile(input))
      if (
        source.length !== manifest.source.bytes ||
        sha256(source) !== manifest.source.sha256
      ) {
        throw new Error("Source social graph does not match its reviewed checksum")
      }
      const graph = await SocialGraph.fromBinary(manifest.root, source)
      // Keep complete follow/mute lists for owners within two hops, including
      // their third-hop targets. No edge cap silently truncates anyone's lists.
      const canonical = await projectSocialGraph(
        graph,
        manifest.root,
        manifest.ownerDistance
      )
      projected = await canonical.toBinary()
    } else {
      projected = await fetch(manifest.publication.url, {
        signal: AbortSignal.timeout(60_000),
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Graph download failed: ${response.status}`)
        return new Uint8Array(await response.arrayBuffer())
      })
    }
    await verify(projected)
    await writeFile(asset, projected)
  } else {
    await verify(await readFile(asset))
  }
  console.log(
    `Verified company discovery graph: ${manifest.users} users, ${manifest.bytes} bytes`
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
