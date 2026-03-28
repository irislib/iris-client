import {describe, expect, it} from "vitest"
import {matchFilter} from "nostr-tools"
import {NDKEvent} from "@/lib/ndk"
import {buildEventTags, buildReplyTags} from "./eventTags"

const ROOT_ID = "a".repeat(64)
const PARENT_ID = "b".repeat(64)
const PARENT_AUTHOR = "c".repeat(64)
const REPLIER = "d".repeat(64)

function createReplyingEvent(tags: string[][]): NDKEvent {
  return new NDKEvent(undefined, {
    id: PARENT_ID,
    kind: 1,
    pubkey: PARENT_AUTHOR,
    content: "nested reply",
    created_at: 1,
    sig: "e".repeat(128),
    tags,
  })
}

describe("buildReplyTags", () => {
  it("uses the thread root marker instead of the first e tag", () => {
    const replyingTo = createReplyingEvent([
      ["e", PARENT_ID, "", "reply"],
      ["e", ROOT_ID, "", "root"],
      ["p", PARENT_AUTHOR],
    ])

    const tags = buildReplyTags(replyingTo, REPLIER)

    expect(tags).toContainEqual(["e", ROOT_ID, "", "root"])
    expect(tags).toContainEqual(["e", PARENT_ID, "", "reply"])

    expect(
      matchFilter(
        {kinds: [1], "#e": [ROOT_ID]},
        {
          id: "f".repeat(64),
          kind: 1,
          pubkey: REPLIER,
          content: "reply to nested reply",
          created_at: 2,
          sig: "0".repeat(128),
          tags,
        }
      )
    ).toBe(true)
  })

  it("falls back to the replied event id when there is no explicit root marker", () => {
    const replyingTo = createReplyingEvent([["p", PARENT_AUTHOR]])

    expect(buildReplyTags(replyingTo, REPLIER)).toContainEqual([
      "e",
      PARENT_ID,
      "",
      "root",
    ])
  })

  it("preserves prebuilt reply tags when augmenting an ndk-created reply event", () => {
    const initialReplyTags = [
      ["e", ROOT_ID, "", "root"],
      ["e", PARENT_ID, "", "reply"],
      ["p", PARENT_AUTHOR],
    ]

    const tags = buildEventTags({
      replyingTo: createReplyingEvent(initialReplyTags),
      initialTags: initialReplyTags,
      includeReplyTags: false,
      quotedEvent: undefined,
      imeta: [],
      text: "reply body",
      expirationDelta: null,
      eventKind: 1,
      title: "",
      price: {amount: "", currency: "USD"},
      myPubKey: REPLIER,
    })

    expect(tags.filter((tag) => tag[0] === "e")).toEqual(initialReplyTags.slice(0, 2))
  })
})
