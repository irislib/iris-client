import {describe, expect, it} from "vitest"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {
  getEventGroup,
  inheritGroupTags,
  isVisibleGroupActivity,
  isVisibleGroupZap,
} from "./activity"
import {groupTags} from "./model"

const key = Uint8Array.from({length: 32}, () => 1)
const otherKey = Uint8Array.from({length: 32}, () => 2)
const author = getPublicKey(key)
const outsider = getPublicKey(otherKey)
const ref = {creator: author, id: "00000000-0000-4000-8000-000000000001"}
const target = "f".repeat(64)
const signed = (secret = key, tags = groupTags(ref), kind = 7) =>
  finalizeEvent(
    {
      kind,
      tags,
      created_at: Math.floor(Date.now() / 1000) - 1,
      content: "+",
    },
    secret
  )

describe("group activity visibility", () => {
  it("re-evaluates cached activity when membership or the selected view changes", () => {
    const events = [signed(), signed(otherKey)]
    const eligible = new Set([author])
    const access = {ref, isEligible: (pubkey: string) => eligible.has(pubkey)}
    const visible = () =>
      events
        .filter((event) => isVisibleGroupActivity(event, access))
        .map((event) => event.pubkey)
    expect(visible()).toEqual([author])
    eligible.delete(author)
    eligible.add(outsider)
    expect(visible()).toEqual([outsider])
    expect(events.filter((event) => isVisibleGroupActivity(event, null))).toHaveLength(2)
  })

  it("rejects forged signatures, a different group, and ambiguous group references", () => {
    const access = {ref, isEligible: () => true}
    const original = signed()
    expect(isVisibleGroupActivity(original, access)).toBe(true)
    const copiedForgery = {...original, content: "copied forged"}
    expect(isVisibleGroupActivity(copiedForgery, access)).toBe(false)
    original.content = "mutated after verification"
    expect(isVisibleGroupActivity(original, access)).toBe(false)
    const forged = JSON.parse(JSON.stringify(signed()))
    forged.content = "forged"
    expect(isVisibleGroupActivity(forged, access)).toBe(false)
    expect(
      isVisibleGroupActivity(signed(key, groupTags({...ref, creator: outsider})), access)
    ).toBe(false)
    expect(getEventGroup({tags: [...groupTags(ref), ["h", ref.id]]})).toBeNull()
    expect(
      getEventGroup({
        tags: [
          ["h", ref.id],
          ["a", `37368:${author}:${ref.id}:extra`],
        ],
      })
    ).toBeNull()
  })

  it("preserves the target group and non-group references when preparing a response", () => {
    const tags = inheritGroupTags({tags: groupTags(ref)}, [
      ["e", target],
      ["h", "wrong"],
      ["a", `37368:${outsider}:${ref.id}`],
      ["a", `30023:${author}:article`],
      ["emoji", "wave", "https://example.com/wave.png"],
    ])
    expect(tags).toEqual([
      ["e", target],
      ["a", `30023:${author}:article`],
      ["emoji", "wave", "https://example.com/wave.png"],
      ...groupTags(ref),
    ])
  })

  it("counts a zap by its signed request author and requires the correct target", () => {
    const access = {ref, isEligible: (pubkey: string) => pubkey === author}
    const request = signed(key, [...groupTags(ref), ["e", target]], 9734)
    const zap = {
      pubkey: author,
      event: {tags: [["description", JSON.stringify(request)]]},
    }
    expect(isVisibleGroupZap(zap, target, access)).toBe(true)
    expect(isVisibleGroupZap(zap, "0".repeat(64), access)).toBe(false)
    expect(isVisibleGroupZap({...zap, pubkey: outsider}, target, access)).toBe(false)
    expect(
      isVisibleGroupZap(
        {
          pubkey: author,
          event: {
            tags: [["description", JSON.stringify({...request, sig: "0".repeat(128)})]],
          },
        },
        target,
        access
      )
    ).toBe(false)
  })
})
