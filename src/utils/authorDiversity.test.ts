import {describe, expect, it} from "vitest"
import {avoidConsecutiveAuthors, orderByAuthorRound} from "./authorDiversity"

const posts = (authors: string[]) => authors.map((pubkey, id) => ({pubkey, id}))

describe("feed author diversity", () => {
  it("keeps priority and all posts while separating repeats", () => {
    const candidates = posts(["a", "a", "b", "a", "b"])
    const result = avoidConsecutiveAuthors(candidates)
    expect(result.map((event) => event.pubkey)).toEqual(["a", "b", "a", "b", "a"])
    expect(avoidConsecutiveAuthors(result)).toEqual(result)
    expect(candidates.map((event) => event.id)).toEqual([0, 1, 2, 3, 4])
  })

  it("separates the next page from the last displayed author", () => {
    expect(
      avoidConsecutiveAuthors(posts(["a", "b", "a", "b"]), "a").map(
        (event) => event.pubkey
      )
    ).toEqual(["b", "a", "b", "a"])
  })

  it("selects older alternative authors before a prolific author's next post", () => {
    const candidates = posts(["a", "a", "a", "b", "b", "b", "c", "c", "c"])
    const first = orderByAuthorRound(candidates).slice(0, 5)
    const remaining = candidates.filter((event) => !first.includes(event))
    const second = orderByAuthorRound(remaining, first.at(-1)?.pubkey)
    expect([...first, ...second].map((event) => event.pubkey)).toEqual([
      "a",
      "b",
      "c",
      "a",
      "b",
      "c",
      "a",
      "b",
      "c",
    ])
  })

  it("does not use up separators before the final author's posts", () => {
    const candidates = posts(["a", "b", "c", "c", "c"])
    expect(avoidConsecutiveAuthors(candidates).map((event) => event.pubkey)).toEqual([
      "c",
      "a",
      "c",
      "b",
      "c",
    ])
  })

  it("retains a single-author feed and handles an empty candidate set", () => {
    const candidates = posts(["a", "a", "a"])
    expect(avoidConsecutiveAuthors(candidates, "a")).toEqual(candidates)
    expect(orderByAuthorRound(candidates, "a")).toEqual(candidates)
    expect(avoidConsecutiveAuthors([])).toEqual([])
    expect(orderByAuthorRound([])).toEqual([])
  })
})
