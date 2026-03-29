import {describe, expect, it} from "vitest"

import {
  initialStableSearchResultsState,
  stableSearchResultsReducer,
} from "./stableSearchResults"

describe("stableSearchResultsReducer", () => {
  it("adopts live results immediately for a new query", () => {
    const next = stableSearchResultsReducer(initialStableSearchResultsState, {
      type: "sync",
      query: "sirius",
      liveResults: [{pubKey: "pubkey-1", name: "Sirius"}],
    })

    expect(next.activeQuery).toBe("sirius")
    expect(next.visibleResults).toEqual([{pubKey: "pubkey-1", name: "Sirius"}])
    expect(next.pendingResults).toBeNull()
  })

  it("stages updated rankings for the same query instead of reordering immediately", () => {
    const current = stableSearchResultsReducer(initialStableSearchResultsState, {
      type: "sync",
      query: "si",
      liveResults: [
        {pubKey: "pubkey-a", name: "Sia"},
        {pubKey: "pubkey-b", name: "Sibyl"},
      ],
    })

    const next = stableSearchResultsReducer(current, {
      type: "sync",
      query: "si",
      liveResults: [
        {pubKey: "pubkey-b", name: "Sibyl"},
        {pubKey: "pubkey-a", name: "Sia"},
      ],
    })

    expect(next.visibleResults).toEqual(current.visibleResults)
    expect(next.pendingResults).toEqual([
      {pubKey: "pubkey-b", name: "Sibyl"},
      {pubKey: "pubkey-a", name: "Sia"},
    ])
  })

  it("applies pending results only when requested", () => {
    const staged = {
      activeQuery: "si",
      visibleResults: [{pubKey: "pubkey-a", name: "Sia"}],
      pendingResults: [{pubKey: "pubkey-b", name: "Sirius"}],
    }

    const next = stableSearchResultsReducer(staged, {type: "applyPending"})

    expect(next.visibleResults).toEqual([{pubKey: "pubkey-b", name: "Sirius"}])
    expect(next.pendingResults).toBeNull()
  })
})
