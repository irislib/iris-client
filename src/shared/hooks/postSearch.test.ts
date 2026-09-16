import {describe, expect, it} from "vitest"
import {createPostSearchMatcher, uniqueSearchAuthors} from "./postSearch"

describe("post search", () => {
  it("matches whole words, case-insensitively, including hashtags and domains", () => {
    const matches = createPostSearchMatcher("iris")
    for (const content of ["Iris!", "https://iris.to", "#IRIS", "try iris today"]) {
      expect(matches({content, tags: []}), content).toBe(true)
    }
    for (const content of ["Irish", "Osiris", "iris2", "iris_app", "éiris", "irisä"]) {
      expect(matches({content, tags: [["t", "iris"]]}), content).toBe(false)
    }
  })

  it("requires every word, in any order, with Unicode normalization", () => {
    const matches = createPostSearchMatcher("  iris   marketplace café  ")
    expect(matches({content: "The marketplace for IRIS at a cafe\u0301", tags: []})).toBe(
      true
    )
    expect(matches({content: "Irish marketplace café", tags: []})).toBe(false)
    expect(matches({content: "Iris café", tags: []})).toBe(false)
  })

  it("treats regex characters literally and keeps explicit hashtag matching", () => {
    expect(createPostSearchMatcher("iris.to")({content: "irisXto", tags: []})).toBe(false)
    const matches = createPostSearchMatcher("iris #marketplace")
    expect(matches({content: "Iris", tags: [["t", "Marketplace"]]})).toBe(true)
    expect(matches({content: "Iris #marketplace", tags: []})).toBe(false)
  })

  it("keeps the first result for each author without changing existing rows", () => {
    const events = [
      {pubkey: "a", id: "newest-a"},
      {pubkey: "a", id: "older-a"},
      {pubkey: "b", id: "newest-b"},
    ]
    const first = uniqueSearchAuthors(events)
    expect(first.map((event) => event.id)).toEqual(["newest-a", "newest-b"])
    expect(
      uniqueSearchAuthors([
        ...first,
        {pubkey: "a", id: "late-a"},
        {pubkey: "c", id: "older-c"},
      ]).map((event) => event.id)
    ).toEqual(["newest-a", "newest-b", "older-c"])
  })
})
