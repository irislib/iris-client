import {describe, expect, it} from "vitest"
import {isFeedReply} from "./feedReplies"

const parent = "a".repeat(64)
const root = "b".repeat(64)

describe("isFeedReply", () => {
  it.each([
    [["e", parent, "", "reply"]],
    [["e", root, "", "root"]],
    [
      ["e", root],
      ["e", parent],
    ],
    [["e", parent]],
  ])("recognizes marked and legacy NIP-10 replies: %j", (...tags) => {
    expect(isFeedReply({kind: 1, tags})).toBe(true)
  })

  it("recognizes NIP-22 comments, including addressable parents", () => {
    expect(isFeedReply({kind: 1111, tags: [["a", "30023:author:article"]]})).toBe(true)
  })

  it("keeps top-level posts, mentions, and quotes", () => {
    expect(isFeedReply({kind: 1, tags: []})).toBe(false)
    expect(isFeedReply({kind: 1, tags: [["e", parent, "", "mention"]]})).toBe(false)
    expect(isFeedReply({kind: 1, tags: [["q", parent]]})).toBe(false)
    expect(isFeedReply({kind: 30023, tags: [["e", parent]]})).toBe(false)
  })
})
