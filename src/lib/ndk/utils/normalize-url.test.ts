import {describe, expect, it} from "vitest"

import {normalizeRelayUrl} from "./normalize-url"

describe("normalizeRelayUrl", () => {
  it("keeps a trailing slash for ordinary relay roots", () => {
    expect(normalizeRelayUrl("wss://relay.example.com")).toBe("wss://relay.example.com/")
  })

  it("preserves authenticated local relay query strings without appending a slash", () => {
    expect(
      normalizeRelayUrl("ws://127.0.0.1:21417/__iris_relay?sessionToken=session-token")
    ).toBe("ws://127.0.0.1:21417/__iris_relay?sessionToken=session-token")
  })
})
