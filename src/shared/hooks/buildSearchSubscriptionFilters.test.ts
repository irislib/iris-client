import {describe, expect, it} from "vitest"

import {buildSearchSubscriptionFilters} from "./buildSearchSubscriptionFilters"

describe("buildSearchSubscriptionFilters", () => {
  it("keeps non-search filters unchanged", () => {
    const filters = {kinds: [1], authors: ["pubkey"]}

    expect(buildSearchSubscriptionFilters(filters, undefined, 100)).toEqual(filters)
  })

  it("builds hashtag-only queries without a broad fallback", () => {
    const filters = {kinds: [1], search: "#Bitcoin"}

    expect(buildSearchSubscriptionFilters(filters, undefined, 100)).toEqual({
      kinds: [1],
      limit: 100,
      "#t": ["bitcoin", "Bitcoin"],
    })
  })

  it("adds a bounded fallback filter for plain keyword search", () => {
    const filters = {kinds: [1], search: "bitcoin"}

    expect(buildSearchSubscriptionFilters(filters, undefined, 100)).toEqual([
      {kinds: [1], limit: 100},
      {kinds: [1], "#t": ["bitcoin"], limit: 100},
      {kinds: [1], search: "bitcoin", limit: 100},
    ])
  })

  it("keeps until on generated filters", () => {
    const filters = {kinds: [1], search: "bitcoin"}

    expect(buildSearchSubscriptionFilters(filters, 123, 100)).toEqual([
      {kinds: [1], until: 123, limit: 100},
      {kinds: [1], until: 123, "#t": ["bitcoin"], limit: 100},
      {kinds: [1], until: 123, search: "bitcoin", limit: 100},
    ])
  })
})
