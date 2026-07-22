import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {NDK, type NDKConstructorParams} from "../ndk/index.js"

describe("NDK AI Guardrails", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe("Cache presence warning", () => {
    it("warns when no cache adapter is set after 2.5s", () => {
      new NDK({aiGuardrails: true})
      vi.advanceTimersByTime(2_500)

      expect(console.warn).toHaveBeenCalled()
      const warnCall = vi.mocked(console.warn).mock.calls[0][0]
      expect(warnCall).toContain("AI_GUARDRAILS WARNING")
      expect(warnCall).toContain("without a cache adapter")
    })

    it.each<[string, NDKConstructorParams]>([
      [
        "a cache adapter is configured",
        {
          aiGuardrails: true,
          cacheAdapter: {query: async () => [], setEvent: async () => {}},
        },
      ],
      ["guardrails are disabled", {aiGuardrails: false}],
      ["the check is skipped", {aiGuardrails: {skip: new Set(["ndk-no-cache"])}}],
    ])("does not warn when %s", (_description, options) => {
      new NDK(options)
      vi.advanceTimersByTime(2_500)

      expect(console.warn).not.toHaveBeenCalled()
    })
  })
})
