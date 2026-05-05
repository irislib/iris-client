import {describe, expect, it} from "vitest"

import {NDK} from "../ndk"
import {NDKPrivateKeySigner} from "../signers/private-key"
import {NDKEvent} from "."

const ndk = new NDK()

async function makeSignedEvent(tags: string[][], content = ""): Promise<NDKEvent> {
  const e = new NDKEvent(ndk, {
    kind: 1,
    created_at: 1700000000,
    tags,
    content,
  })
  await e.sign(NDKPrivateKeySigner.generate())
  return e
}

describe("NDKEvent.reply()", () => {
  it("does not carry over the parent's 'reply' marker as a second reply tag", async () => {
    // Reproduces a real bug observed in the wild: replying to an event whose
    // own tags contain `["e", X, "...", "reply"]` produced a new event with
    // TWO "reply" markers — the parent's old one (pointing at X) plus the
    // new one (pointing at the parent). Clients picking the first reply
    // marker rendered the new event as a reply to X instead of the parent.
    const rootId = "00002ce0d113d8aaa88d05db89df616cec6ce3995b5a65eefebb41a7c8ed8624"
    const grandparentId = "9e2da5f7122ac08361001bdc886335fac5378cb4b227babc122c382a88451999"
    const grandparentAuthor = "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0"

    const parent = await makeSignedEvent([
      ["e", rootId, "wss://nostr21.com", "root"],
      ["e", grandparentId, "wss://nos.lol", "reply"],
      ["p", grandparentAuthor],
    ])

    const reply = parent.reply()
    const eTags = reply.tags.filter((t) => t[0] === "e")
    const replyMarkers = eTags.filter((t) => t[3] === "reply")
    const rootMarkers = eTags.filter((t) => t[3] === "root")

    expect(replyMarkers).toHaveLength(1)
    expect(replyMarkers[0][1]).toBe(parent.id)
    expect(rootMarkers).toHaveLength(1)
    expect(rootMarkers[0][1]).toBe(rootId)

    // The parent's old reply marker (grandparent) must not appear at all.
    expect(eTags.some((t) => t[1] === grandparentId)).toBe(false)
  })

  it("preserves the parent's root marker when replying to a non-root note", async () => {
    const root = await makeSignedEvent([], "root note")
    const parent = await makeSignedEvent([
      ["e", root.id, "", "root", root.pubkey],
      ["p", root.pubkey],
    ])

    const reply = parent.reply()
    const rootMarkers = reply.tags.filter((t) => t[0] === "e" && t[3] === "root")
    const replyMarkers = reply.tags.filter((t) => t[0] === "e" && t[3] === "reply")

    expect(rootMarkers).toHaveLength(1)
    expect(rootMarkers[0][1]).toBe(root.id)
    expect(replyMarkers).toHaveLength(1)
    expect(replyMarkers[0][1]).toBe(parent.id)
  })

  it("uses the parent itself as root when the parent has no e-tags", async () => {
    const parent = await makeSignedEvent([], "fresh root")

    const reply = parent.reply()
    const rootMarkers = reply.tags.filter((t) => t[0] === "e" && t[3] === "root")

    expect(rootMarkers).toHaveLength(1)
    expect(rootMarkers[0][1]).toBe(parent.id)
  })

  it("upgrades NIP-10 deprecated positional e-tags by treating the first as root", async () => {
    const rootId = "a".repeat(64)
    const middleId = "b".repeat(64)
    const parent = await makeSignedEvent([
      ["e", rootId],
      ["e", middleId],
    ])

    const reply = parent.reply()
    const eTags = reply.tags.filter((t) => t[0] === "e")
    const rootMarkers = eTags.filter((t) => t[3] === "root")
    const replyMarkers = eTags.filter((t) => t[3] === "reply")

    // First positional tag becomes the explicit root.
    expect(rootMarkers).toHaveLength(1)
    expect(rootMarkers[0][1]).toBe(rootId)
    // Intermediate positional tags are dropped — only one reply marker exists.
    expect(replyMarkers).toHaveLength(1)
    expect(replyMarkers[0][1]).toBe(parent.id)
    expect(eTags.some((t) => t[1] === middleId)).toBe(false)
  })
})
