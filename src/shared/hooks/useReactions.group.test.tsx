// @vitest-environment jsdom
import {act} from "react"
import {createRoot} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {AppEvent, type EventFilter} from "@/lib/nostr"
import {groupTags} from "@/groups/model"
import type {GroupActivityAccess} from "@/groups/activity"
import {useReactionsByAuthor} from "./useReactions"

const state = vi.hoisted(() => ({
  access: null as (GroupActivityAccess & {visiblePubkeys: Set<string>}) | null,
  listeners: new Set<(event: AppEvent) => void>(),
  filters: [] as EventFilter[][],
}))
vi.mock("@/groups/GroupContext", () => ({useGroupAccess: () => state.access}))
vi.mock("@/utils/visibility", () => ({shouldHideUser: () => false}))
vi.mock("@/utils/nostrClient", () => ({
  nostr: () => ({
    subscribe: (filters: EventFilter[]) => {
      state.filters.push(filters)
      let listener: (event: AppEvent) => void
      return {
        on: (name: string, callback: typeof listener) => {
          if (name === "event") {
            listener = callback
            state.listeners.add(callback)
          }
        },
        start: () => {},
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
const reaction = (secret: Uint8Array, time = 100) =>
  new AppEvent(
    undefined,
    finalizeEvent(
      {
        kind: 7,
        content: "+",
        created_at: time,
        tags: [["e", targetId], ...groupTags(ref)],
      },
      secret
    )
  )
const access = (...authors: string[]) => ({
  ref,
  visiblePubkeys: new Set(authors),
  isVisibleMember: (pubkey: string) => authors.includes(pubkey),
})
function Counter() {
  const reactions = useReactionsByAuthor(targetId)
  return <output>{[...reactions.keys()].sort().join(",")}</output>
}
afterEach(() => {
  state.listeners.clear()
  state.filters = []
  state.access = null
  vi.useRealTimers()
})

describe("group reaction subscriptions", () => {
  it("rejects untrusted floods and reloads per author when the visible trust set changes", async () => {
    ;(
      globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}
    ).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const host = document.createElement("div")
    const root = createRoot(host)
    state.access = access(author)
    await act(async () => root.render(<Counter />))
    expect(state.filters.flat().every((filter) => filter.authors?.includes(author))).toBe(
      true
    )
    expect(state.filters[1][0].limit).toBe(1)
    await act(async () => {
      for (const listener of state.listeners) {
        for (let i = 200; i < 230; i++) listener(reaction(otherKey, i))
        listener(reaction(key))
      }
      vi.advanceTimersByTime(50)
    })
    expect(host.textContent).toBe(author)
    const stale = [...state.listeners]
    state.access = access(outsider)
    await act(async () => root.render(<Counter />))
    expect(host.textContent).toBe("")
    expect(state.filters.at(-1)?.[0].authors).toEqual([outsider])
    await act(async () => {
      for (const listener of stale) listener(reaction(key, 400))
      for (const listener of state.listeners) listener(reaction(otherKey, 300))
      vi.advanceTimersByTime(50)
    })
    expect(host.textContent).toBe(outsider)
    const forged = reaction(otherKey, 400)
    forged.content = "forged"
    await act(async () => {
      for (const listener of state.listeners) listener(forged)
      vi.advanceTimersByTime(50)
    })
    expect(host.textContent).toBe(outsider)
    state.access = access()
    await act(async () => root.render(<Counter />))
    expect(host.textContent).toBe("")
    expect(state.listeners.size).toBe(0)
    await act(async () => root.unmount())
  })
})
