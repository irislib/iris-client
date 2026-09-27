// @vitest-environment jsdom
import {act} from "react"
import {createRoot} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {NDKEvent} from "@/lib/ndk"
import {groupTags} from "@/groups/model"
import type {GroupActivityAccess} from "@/groups/activity"
import {useReactionsByAuthor} from "./useReactions"

const state = vi.hoisted(() => ({
  access: null as GroupActivityAccess | null,
  listeners: new Set<(event: NDKEvent) => void>(),
  subscriptions: 0,
}))
vi.mock("@/groups/GroupContext", () => ({useGroupAccess: () => state.access}))
vi.mock("@/utils/visibility", () => ({shouldHideUser: () => false}))
vi.mock("@/utils/ndk", () => ({
  ndk: () => ({
    subscribe: () => {
      state.subscriptions++
      let listener: (event: NDKEvent) => void
      return {
        on: (_name: string, callback: typeof listener) => {
          listener = callback
          state.listeners.add(callback)
        },
        stop: () => state.listeners.delete(listener),
      }
    },
  }),
}))

const key = Uint8Array.from({length: 32}, () => 1)
const otherKey = Uint8Array.from({length: 32}, () => 2)
const author = getPublicKey(key)
const outsider = getPublicKey(otherKey)
const ref = {creator: author, id: "00000000-0000-4000-8000-000000000001"}
const targetId = "f".repeat(64)
const reaction = (secret: Uint8Array) =>
  new NDKEvent(
    undefined,
    finalizeEvent(
      {
        kind: 7,
        content: "+",
        created_at: Math.floor(Date.now() / 1000) - 1,
        tags: [["e", targetId], ...groupTags(ref)],
      },
      secret
    )
  )

function Counter() {
  const reactions = useReactionsByAuthor(targetId)
  return <output>{[...reactions.keys()].join(",")}</output>
}

afterEach(() => {
  state.listeners.clear()
  state.subscriptions = 0
  state.access = null
})

describe("group reaction subscriptions", () => {
  it("recomputes previously received reactions after a policy change without a relay reload", async () => {
    ;(
      globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}
    ).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement("div")
    const root = createRoot(host)
    state.access = {ref, isEligible: (pubkey) => pubkey === author}
    await act(async () => root.render(<Counter />))
    await act(async () => {
      for (const listener of state.listeners) {
        listener(reaction(key))
        listener(reaction(otherKey))
      }
    })
    expect(host.textContent).toBe(author)

    state.access = {ref, isEligible: (pubkey) => pubkey === outsider}
    await act(async () => root.render(<Counter />))
    expect(host.textContent).toBe(outsider)
    expect(state.subscriptions).toBe(1)

    const forged = reaction(otherKey)
    forged.content = "forged"
    forged.created_at! += 1
    await act(async () => {
      for (const listener of state.listeners) listener(forged)
    })
    expect(host.textContent).toBe(outsider)

    state.access = {ref, isEligible: () => false}
    await act(async () => root.render(<Counter />))
    expect(host.textContent).toBe("")
    await act(async () => root.unmount())
  })
})
