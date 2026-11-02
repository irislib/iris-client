import {expect, it} from "vitest"
import {SocialGraph} from "nostr-social-graph"
import {projectSocialGraph} from "../../scripts/projectSocialGraph"

const key = (n: number) => n.toString(16).padStart(64, "0")
type List = [owner: number, timestamp: number, targets: number[]]

// Real v2 binary shape with two internal IDs for the same public key. The root
// points at one alias while the usable follow list belongs to the other.
async function aliases(follows: List[], mutes: List[] = []) {
  const bytes: number[] = []
  const integer = (value: number) => {
    while (value >= 128) {
      bytes.push((value & 127) | 128)
      value >>>= 7
    }
    bytes.push(value)
  }
  integer(2)
  const keys = [1, 2, 2, 3, 4, 5, 6]
  integer(keys.length)
  keys.forEach((n, id) => {
    bytes.push(...Buffer.from(key(n), "hex"))
    integer(id)
  })
  for (const lists of [follows, mutes]) {
    integer(lists.length)
    for (const [owner, timestamp, targets] of lists) {
      integer(owner)
      integer(timestamp)
      integer(targets.length)
      targets.forEach(integer)
    }
  }
  return SocialGraph.fromBinary(key(1), new Uint8Array(bytes))
}

it("resolves aliases before traversal and preserves tied mutes through export", async () => {
  const source = await aliases(
    [
      [0, 1, [1]],
      [2, 2, [3]],
      [3, 3, [6]],
    ],
    [
      [1, 5, [4]],
      [2, 5, [5]],
      [3, 10, []],
    ]
  )
  const projection = await projectSocialGraph(source, key(1), 1)
  const graph = await SocialGraph.fromBinary(key(1), await projection.toBinary())
  expect(graph.getFollowedByUser(key(2))).toEqual(new Set([key(3)]))
  expect(graph.getFollowDistance(key(3))).toBe(2)
  expect(graph.getFollowDistance(key(6))).toBe(1000)
  expect(graph.getMutedByUser(key(2))).toEqual(new Set([key(4), key(5)]))
  expect(graph.getMuteListCreatedAt(key(2))).toBe(5)
  const ids = [...graph.getInternalData().ids].map(([, pubkey]) => pubkey)
  expect(new Set(ids).size).toBe(ids.length)
  const wider = await projectSocialGraph(source, key(1), 2)
  const exported = await SocialGraph.fromBinary(key(1), await wider.toBinary())
  expect(exported.getMuteListCreatedAt(key(3))).toBe(10)
})

it("uses newer lists including explicit empty mutes over older aliases", async () => {
  const source = await aliases(
    [
      [0, 1, [1]],
      [1, 1, [4]],
      [2, 2, [3]],
    ],
    [
      [1, 5, [4]],
      [2, 6, []],
    ]
  )
  const graph = await projectSocialGraph(source, key(1), 1)
  expect(graph.getFollowedByUser(key(2))).toEqual(new Set([key(3)]))
  expect(graph.getMutedByUser(key(2))).toEqual(new Set())
  expect(graph.getMuteListCreatedAt(key(2))).toBe(6)
})

it("rejects conflicting latest follows rather than broadening discovery trust", async () => {
  const source = await aliases([
    [0, 1, [1]],
    [1, 2, [3]],
    [2, 2, [4]],
  ])
  await expect(projectSocialGraph(source, key(1), 1)).rejects.toThrow(
    "conflicting latest follow lists"
  )
})
