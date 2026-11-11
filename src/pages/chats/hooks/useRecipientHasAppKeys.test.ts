import {describe, expect, it} from "vitest"

import {applySessionFallbackHasAppKeys} from "./useRecipientHasAppKeys"

describe("applySessionFallbackHasAppKeys", () => {
  it("does not override explicit empty AppKeys false", () => {
    expect(applySessionFallbackHasAppKeys(false, true)).toBe(false)
  })

  it("converts unknown state to true when local session exists", () => {
    expect(applySessionFallbackHasAppKeys(null, true)).toBe(true)
  })

  it("keeps unknown state when no local session exists", () => {
    expect(applySessionFallbackHasAppKeys(null, false)).toBe(null)
  })
})
