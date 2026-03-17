import {describe, expect, it} from "vitest"

import {
  applySessionFallbackHasAppKeys,
  computeTimeoutFallbackHasAppKeys,
} from "./useRecipientHasAppKeys"
import {hasExistingSessionWithRecipient} from "@/utils/sessionRouting"

describe("computeTimeoutFallbackHasAppKeys", () => {
  it("keeps explicit empty AppKeys as false even when we have a local session", () => {
    expect(computeTimeoutFallbackHasAppKeys(false, true)).toBe(false)
  })

  it("uses local session as fallback when no AppKeys response arrived yet", () => {
    expect(computeTimeoutFallbackHasAppKeys(null, true)).toBe(true)
  })

  it("returns false when no AppKeys response and no local session", () => {
    expect(computeTimeoutFallbackHasAppKeys(null, false)).toBe(false)
  })
})

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
