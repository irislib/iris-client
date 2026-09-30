import {describe, it, expect} from "vitest"
import {createGroupRumor, unwrapGroupRumor} from "./groupRumor"

const owner = "a".repeat(64)
const device = "b".repeat(64)
const inner = createGroupRumor("group", owner, {kind: 14, content: "hello"}, 1000)
const wrap = (content = JSON.stringify(inner)) =>
  createGroupRumor("group", device, {kind: 14, content}, 1000)

describe("native group rumors", () => {
  it("preserves application IDs and content across the native wire format", () => {
    expect(unwrapGroupRumor(wrap(), "group", owner, device)).toEqual(inner)
    expect(inner.tags).toEqual([
      ["l", "group"],
      ["ms", "1000"],
    ])
  })
  it("keeps legacy plain group text readable", () => {
    const old = wrap("plain text")
    expect(unwrapGroupRumor(old, "group", owner, device)).toEqual(old)
  })
  it("rejects an altered ID, another sender, and another group", () => {
    expect(
      unwrapGroupRumor(
        wrap(JSON.stringify({...inner, content: "tampered"})),
        "group",
        owner,
        device
      )
    ).toBeNull()
    expect(unwrapGroupRumor(wrap(), "group", "c".repeat(64), device)).toBeNull()
    expect(unwrapGroupRumor(wrap(), "another-group", owner, device)).toBeNull()
  })
})
