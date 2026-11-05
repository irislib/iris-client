// Offline known-person retrieval proxy, not click data or human relevance labels.
// Run: pnpm exec tsx scripts/evaluate-people-search.ts
// Uses pinned package profiles and Iris's pinned graph; no network or graph writes.
// The first 120 SHA-ordered profiles per cohort were exploratory. Exclude their
// union from every held-out cohort so targets cannot leak between network views.
// Also exclude the next validation cohort, used to set the familiarity cap.
import {createHash} from "node:crypto"
import {readFileSync} from "node:fs"
import Fuse from "fuse.js"
import {SocialGraph} from "nostr-social-graph"
import {calculateRanking, createRankingSnapshot} from "nostr-social-graph/ranking"
import {
  hasProfileSearchExactMatch,
  hasProfileSearchPrefixMatch,
  type SearchResult,
} from "../src/utils/profileSearchData"
import {
  normalizeProfileSearchQuery as normalize,
  rankProfileSearchResults,
} from "../src/utils/profileSearchRanking"

type Hit = {item: SearchResult; score?: number; source: "local"}
type Graph = Pick<SocialGraph, "getFollowDistance" | "followedByFriends">
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex")
const graphBytes = readFileSync(new URL("../src/assets/socialGraph.bin", import.meta.url))
const metadata = JSON.parse(
  readFileSync(new URL("../src/assets/socialGraph.json", import.meta.url), "utf8")
)
if (hash(graphBytes) !== metadata.sha256) throw new Error("Graph snapshot hash mismatch")
const profileBytes = readFileSync(
  new URL(import.meta.resolve("nostr-social-graph/data/profileData.json"))
)
const profiles: SearchResult[] = JSON.parse(profileBytes.toString()).map(
  ([pubKey, name, nip05]: string[]) => ({pubKey, name, nip05})
)
const graph = await SocialGraph.fromBinary(metadata.root, graphBytes)
const roots = [metadata.root, ...graph.getFollowedByUser(metadata.root)]
const orderedProfiles = profiles
  .filter((p) => p.name.trim().length >= 3)
  .map((profile) => ({profile, hash: hash(profile.pubKey)}))
  .sort((a, b) => a.hash.localeCompare(b.hash))
  .map(({profile}) => profile)
const explored = new Set(orderedProfiles.slice(0, 120).map((p) => p.pubKey))
for (const root of roots) {
  const follows = graph.getFollowedByUser(root)
  for (const profile of orderedProfiles
    .filter((p) => follows.has(p.pubKey))
    .slice(0, 120)) {
    explored.add(profile.pubKey)
  }
}
const excluded = new Set(explored)
for (const root of roots) {
  const follows = graph.getFollowedByUser(root)
  for (const cohort of ["mixed", "followed"]) {
    for (const profile of orderedProfiles
      .filter(
        (p) => !explored.has(p.pubKey) && (cohort === "mixed" || follows.has(p.pubKey))
      )
      .slice(0, 120)) {
      excluded.add(profile.pubKey)
    }
  }
}
const fuse = new Fuse(profiles, {
  keys: ["name", "aliases", "nip05", "pubKey"],
  includeScore: true,
})
// Frozen pre-change scoring, restricted to the local, multi-character queries
// in this evaluator. Candidate retrieval and text rules are identical in all arms.
function previousRanking(hits: Hit[], query: string, social: Graph) {
  return hits
    .map(({item, score}) => {
      const normalized = {
        ...item,
        name: normalize(item.name),
        nip05: normalize(item.nip05 ?? ""),
      }
      const distance = social.getFollowDistance(item.pubKey)
      return {
        item,
        score:
          (1 - (score ?? 1)) * 5 -
          0.01 * (distance === 0 ? 100 : distance - 1) +
          0.005 * social.followedByFriends(item.pubKey).size +
          (hasProfileSearchExactMatch(normalized, query) ? 3 : 0) +
          (hasProfileSearchPrefixMatch(normalized, query) ? 1 : 0),
      }
    })
    .sort((a, b) => b.score - a.score)
    .map(({item}) => item)
}

const total = () => ({queries: 0, reciprocalRank: 0, top1: 0, top5: 0})
type Total = ReturnType<typeof total>
const metrics = (s: Total) => ({
  queries: s.queries,
  mrr: s.queries ? s.reciprocalRank / s.queries : 0,
  top1: s.top1,
  top5: s.top5,
})
const totals: Record<string, Total> = {
  previous: total(),
  bounded: total(),
  pagerank: total(),
}
const deltas = new Map<string, number[]>()
const cohortResults = []
const graphResults = []
const hitCache = new Map<string, Hit[]>()
for (const [rootIndex, root] of roots.entries()) {
  await graph.setRoot(root)
  // Match isOvermuted(..., 1) in the search callers without importing their
  // browser stores into Node. All arms share the same visible candidate pool.
  const visible = new Set(
    profiles
      .filter(({pubKey}) => {
        if (pubKey === root) return true
        const muters = graph.getUserMutedBy(pubKey)
        if (!muters.size) return true
        if (muters.has(root)) return false
        const nearest = Object.entries(graph.stats(pubKey))
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, counts]) => counts)
          .find(({followers, muters}) => followers + muters > 0)
        return !nearest || nearest.muters <= nearest.followers
      })
      .map((p) => p.pubKey)
  )
  const start = performance.now()
  const snapshot = createRankingSnapshot(graph)
  const preparationMs = performance.now() - start
  const calculationStart = performance.now()
  const rank = calculateRanking(snapshot, {damping: 0.5})
  if (!rank.converged) throw new Error("PageRank failed to converge")
  graphResults.push({
    rootIndex,
    directFollows: graph.getFollowedByUser(root).size,
    nodes: rank.nodes,
    edges: rank.edges,
    preparationMs,
    calculationMs: performance.now() - calculationStart,
    workingArrayBytes: rank.workingArrayBytes,
  })
  // Cache immutable input lookups equally for all arms during this offline replay.
  const distances = new Map(
    profiles.map((p) => [p.pubKey, graph.getFollowDistance(p.pubKey)])
  )
  const followers = new Map(
    profiles.map((p) => [p.pubKey, graph.followedByFriends(p.pubKey)])
  )
  const social: Graph = {
    getFollowDistance: (key) => distances.get(key) ?? 1000,
    followedByFriends: (key) => followers.get(key) ?? new Set<string>(),
  }
  // Best of the nine exploratory PageRank variants: damping .5, saturation at
  // .2 * directSeed. Same maximum 0.5-point social contribution as bounded counts.
  const pageRankSocial: Graph = {
    ...social,
    followedByFriends: (key) => {
      const value = rank.get(key)
      return {size: (100 * value) / (value + rank.directSeed * 0.2 || 1)} as Set<string>
    },
  }
  const follows = graph.getFollowedByUser(root)
  for (const cohort of ["mixed", "followed"] as const) {
    const selected = orderedProfiles
      .filter(
        (p) =>
          visible.has(p.pubKey) &&
          !excluded.has(p.pubKey) &&
          (cohort === "mixed" || follows.has(p.pubKey))
      )
      .slice(0, 120)
    for (const queryType of ["exact", "prefix", "typo"] as const) {
      const scores: typeof totals = {
        previous: total(),
        bounded: total(),
        pagerank: total(),
      }
      for (const target of selected) {
        const name = normalize(target.name)
        let query = name
        if (queryType === "prefix") query = name.slice(0, 4)
        if (queryType === "typo")
          query = name.slice(0, -2) + name.slice(-1) + name.slice(-2, -1)
        if (query.length < 2) continue
        let hits = hitCache.get(query)
        if (!hits) {
          hits = fuse
            .search(query)
            .map((h) => ({item: h.item, score: h.score, source: "local"}))
          hitCache.set(query, hits)
        }
        const visibleHits = hits.filter((hit) => visible.has(hit.item.pubKey))
        const arms = {
          previous: previousRanking(visibleHits, query, social),
          bounded: rankProfileSearchResults(visibleHits, query, social),
          pagerank: rankProfileSearchResults(visibleHits, query, pageRankSocial),
        }
        const reciprocalRanks: Record<string, number> = {}
        for (const [method, ordered] of Object.entries(arms)) {
          const position = ordered.findIndex((p) => p.pubKey === target.pubKey) + 1
          const rr = position > 0 ? 1 / position : 0
          reciprocalRanks[method] = rr
          for (const counts of [scores[method], totals[method]]) {
            counts.queries++
            counts.reciprocalRank += rr
            counts.top1 += Number(position === 1)
            counts.top5 += Number(position > 0 && position <= 5)
          }
        }
        const differences = deltas.get(target.pubKey) ?? []
        differences.push(reciprocalRanks.pagerank - reciprocalRanks.bounded)
        deltas.set(target.pubKey, differences)
      }
      cohortResults.push({
        rootIndex,
        cohort,
        queryType,
        results: Object.fromEntries(
          Object.entries(scores).map(([k, v]) => [k, metrics(v)])
        ),
      })
    }
  }
}
// Cluster by target so repeated roots and query variants aren't counted as
// independent evidence. This interval still describes only the proxy fixture.
let randomState = 20261105
const random = () =>
  (randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0) / 2 ** 32
const clusters = [...deltas.values()]
const bootstrap = Array.from({length: 2000}, () => {
  let sum = 0,
    count = 0
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[Math.floor(random() * clusters.length)]
    for (const delta of cluster) {
      sum += delta
      count++
    }
  }
  return sum / count
}).sort((a, b) => a - b)
console.log(
  JSON.stringify(
    {
      method: "Generated known-person queries; proxy only, no human or click labels",
      graphSha256: hash(graphBytes),
      profilesSha256: hash(profileBytes),
      profiles: profiles.length,
      holdout:
        "First 120 SHA256-ordered targets per cohort after excluding all exploration and validation targets",
      limitations: [
        "One incomplete captured graph",
        "Root contexts share edges",
        "Uniform target selection differs from real search traffic",
        "No mobile latency measurement",
      ],
      totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, metrics(v)])),
      pageRankDeltaVsBounded95: [bootstrap[50], bootstrap[1949]],
      targetClusters: clusters.length,
      graphResults,
      cohortResults,
    },
    null,
    2
  )
)
