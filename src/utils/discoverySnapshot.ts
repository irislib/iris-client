import type {SocialGraph} from "nostr-social-graph"

export interface DiscoveryLimits {
  maxBytes?: number
  maxNodes?: number
  maxEdges?: number
  maxDistance?: number
  maxEdgesPerNode?: number
}

export async function selectGraphBytes(
  graph: SocialGraph,
  limits: DiscoveryLimits,
  original?: Uint8Array
) {
  for (const n of Object.values(limits)) {
    if (n !== undefined && (!Number.isSafeInteger(n) || n < 1)) {
      throw new Error("Graph limits must be positive whole numbers")
    }
  }
  const sourceNodes = graph.getInternalData().ids.size
  let nodes = Math.max(1, Math.min(limits.maxNodes ?? sourceNodes, sourceNodes))
  const entireGraph =
    nodes >= sourceNodes &&
    !limits.maxEdges &&
    !limits.maxDistance &&
    !limits.maxEdgesPerNode
  if (
    entireGraph &&
    original &&
    (limits.maxBytes === undefined || original.length <= limits.maxBytes)
  )
    return original
  if (entireGraph && !limits.maxBytes) return graph.toBinary()
  // Every retained node consumes at least one byte. Bound work before encoding a local graph.
  if (limits.maxBytes) nodes = Math.min(nodes, limits.maxBytes)
  const encode = () =>
    graph.toBinary(nodes, limits.maxEdges, limits.maxDistance, limits.maxEdgesPerNode)
  let bytes = await encode()
  // Narrow the SDK's own traversal budget so its list revision/completeness logic remains authoritative.
  while (limits.maxBytes !== undefined && bytes.length > limits.maxBytes) {
    if (nodes === 1) throw new Error("Snapshot exceeds the selected size")
    nodes = Math.max(
      1,
      Math.floor(nodes * Math.min(0.85, limits.maxBytes / bytes.length))
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    bytes = await encode()
  }
  return bytes
}
