import {finalizeEvent, generateSecretKey} from "nostr-tools"
import {describe, expect, it} from "vitest"
import {NDKEvent} from "."

describe("NDK event signature validation", () => {
  it("verifies hex-encoded Nostr signatures with Noble v2", () => {
    const rawEvent = finalizeEvent(
      {kind: 1, created_at: 1_700_000_000, content: "signed", tags: []},
      generateSecretKey()
    )

    expect(new NDKEvent(undefined, rawEvent).verifySignature(false)).toBe(true)
  })
})
