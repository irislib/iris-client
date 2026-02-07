import {describe, expect, it} from "vitest"

import {SortedMap} from "@/utils/SortedMap/SortedMap"
import type {MessageType} from "../message/Message"
import {groupMessages} from "./messageGrouping"

const makeMessage = (args: {id: string; pubkey: string; ms: number}): MessageType => {
  return {
    id: args.id,
    pubkey: args.pubkey,
    created_at: Math.floor(args.ms / 1000),
    kind: 4,
    content: "hi",
    tags: [["ms", String(args.ms)]],
  }
}

describe("groupMessages", () => {
  it("groups DM bubbles across consecutive minutes even when > 60s apart", () => {
    const m1ms = new Date("2026-01-01T12:01:05.000Z").getTime()
    const m2ms = new Date("2026-01-01T12:02:50.000Z").getTime() // 105s later

    const m1 = makeMessage({id: "m1", pubkey: "alice", ms: m1ms})
    const m2 = makeMessage({id: "m2", pubkey: "alice", ms: m2ms})

    const messages = new SortedMap<string, MessageType>(undefined, "created_at")
    messages.set(m1.id, m1)
    messages.set(m2.id, m2)

    const groups = groupMessages(messages, undefined, false, true)
    expect(groups).toHaveLength(1)
    expect(groups[0].map((m) => m.id)).toEqual(["m1", "m2"])
  })

  it("does not group DM bubbles when they are not in consecutive minutes and are > 60s apart", () => {
    const m1ms = new Date("2026-01-01T12:01:05.000Z").getTime()
    const m2ms = new Date("2026-01-01T12:03:04.000Z").getTime() // 119s later, but minute buckets differ by 2

    const m1 = makeMessage({id: "m1", pubkey: "alice", ms: m1ms})
    const m2 = makeMessage({id: "m2", pubkey: "alice", ms: m2ms})

    const messages = new SortedMap<string, MessageType>(undefined, "created_at")
    messages.set(m1.id, m1)
    messages.set(m2.id, m2)

    const groups = groupMessages(messages, undefined, false, true)
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.map((m) => m.id))).toEqual([["m1"], ["m2"]])
  })

  it("keeps the 60s threshold behavior for non-DM chats even if consecutive minutes", () => {
    const m1ms = new Date("2026-01-01T12:01:05.000Z").getTime()
    const m2ms = new Date("2026-01-01T12:02:50.000Z").getTime() // 105s later, consecutive minutes

    const m1 = makeMessage({id: "m1", pubkey: "alice", ms: m1ms})
    const m2 = makeMessage({id: "m2", pubkey: "alice", ms: m2ms})

    const messages = new SortedMap<string, MessageType>(undefined, "created_at")
    messages.set(m1.id, m1)
    messages.set(m2.id, m2)

    const groups = groupMessages(messages, undefined, true, false)
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.map((m) => m.id))).toEqual([["m1"], ["m2"]])
  })
})

