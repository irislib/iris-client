import {describe, expect, it} from "vitest"
import {rankProfileSearchResults} from "./profileSearchRanking"

const local = (name: string, score = 0) => ({
  item: {pubKey: name, name},
  source: "local" as const,
  score,
})

describe("profile search ranking shared by search and mentions", () => {
  it("ranks a close name match above raw fuzzy matches", () => {
    const results = rankProfileSearchResults(
      [local("Bellatrix", 0.4), local("Ben Arc", 0.01), local("Ben", 0.01)],
      "ben"
    )
    expect(results.map((item) => item.name)).toEqual(["Ben", "Ben Arc", "Bellatrix"])
  })

  it("only includes prefix matches for a single character, including aliases", () => {
    const result = rankProfileSearchResults(
      [
        local("Zebra"),
        local("Ben"),
        {...local("Robert"), item: {pubKey: "Robert", name: "Robert", aliases: ["Bob"]}},
      ],
      "b"
    )
    expect(result.map((item) => item.pubKey)).toEqual(["Ben", "Robert"])
  })

  it("treats underscores as spaces while keeping literal underscore handles", () => {
    const hits = [local("John Smith"), local("John_Smith")]
    expect(rankProfileSearchResults(hits, "john_smith")).toEqual(
      hits.map((hit) => hit.item)
    )
    expect(rankProfileSearchResults(hits, "john smith")).toEqual(
      hits.map((hit) => hit.item)
    )
  })

  it("compares local distance scores and remote relevance scores in the same direction", () => {
    const remote = {
      item: {pubKey: "remote", name: "Ben Remote"},
      source: "remote" as const,
      score: 1,
    }
    const unrelated = {...remote, item: {pubKey: "unrelated", name: "Alice"}, score: 100}
    expect(
      rankProfileSearchResults([local("Ben Local", 0.8), unrelated, remote], "ben").map(
        (item) => item.pubKey
      )
    ).toEqual(["remote", "Ben Local"])
  })

  it("prioritizes people in the user's network with the same matching name", () => {
    const graph = {
      getFollowDistance: (pubKey: string) => (pubKey === "Ben Friend" ? 1 : 999),
      followedByFriends: () => new Set<string>(),
    }
    expect(
      rankProfileSearchResults(
        [local("Ben Stranger"), local("Ben Friend")],
        "ben",
        graph
      ).map((item) => item.name)
    ).toEqual(["Ben Friend", "Ben Stranger"])
  })
})
