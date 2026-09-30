// @vitest-environment jsdom
import {act} from "react"
import {createRoot} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"
import {useGroupEvents} from "./useGroupEvents"

const state = vi.hoisted(() => ({
  subs: [] as {stopped: boolean; closeOnEose: boolean; eose?: () => void}[],
}))
vi.mock("@/lib/nostr", () => ({CacheMode: {PARALLEL: "PARALLEL"}}))
vi.mock("@/utils/nostrClient", () => ({
  nostr: () => ({
    subscribe: (_filters: unknown, options: {closeOnEose: boolean}) => {
      const sub = {
        stopped: false,
        closeOnEose: options.closeOnEose,
        eose: undefined as (() => void) | undefined,
        on: (name: string, callback: () => void) => {
          if (name === "eose") sub.eose = callback
        },
        start: () => {},
        stop: () => {
          sub.stopped = true
        },
      }
      state.subs.push(sub)
      return sub
    },
  }),
}))
afterEach(() => {
  state.subs = []
})

function Read({revision = 0, id = "shared"}: {revision?: number; id?: string}) {
  const snapshot = useGroupEvents([{kinds: [1], "#d": [id]}], 20, {refreshKey: revision})
  return <output>{snapshot.loading ? "loading" : "ready"}</output>
}

describe("shared group event hook", () => {
  it("starts closed, shares readers, and refreshes one reader without stopping another", async () => {
    ;(
      globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}
    ).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement("div")
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <>
          <Read />
          <Read />
        </>
      )
    )
    expect(host.textContent).toBe("loadingloading")
    expect(state.subs).toHaveLength(2)
    await act(async () => state.subs[1].eose?.())
    expect(host.textContent).toBe("readyready")
    await act(async () =>
      root.render(
        <>
          <Read revision={1} />
          <Read />
        </>
      )
    )
    expect(host.textContent).toBe("loadingready")
    expect(state.subs).toHaveLength(4)
    expect(state.subs[0].stopped).toBe(false)
    await act(async () => root.unmount())
    expect(state.subs.every((sub) => sub.stopped)).toBe(true)
  })

  it("does not evict an active empty collection when inactive registry entries are trimmed", async () => {
    const host = document.createElement("div")
    const root = createRoot(host)
    const active = <Read key="active" id="active-empty" />
    await act(async () =>
      root.render(
        <>
          {active}
          {Array.from({length: 105}, (_, n) => (
            <Read key={n} id={`inactive-${n}`} />
          ))}
        </>
      )
    )
    const original = state.subs[0]
    await act(async () => root.render(<>{active}</>))
    const count = state.subs.length
    await act(async () =>
      root.render(
        <>
          {active}
          <Read id="active-empty" />
        </>
      )
    )
    expect(original.stopped).toBe(false)
    expect(state.subs).toHaveLength(count)
    await act(async () => root.unmount())
  })
})
