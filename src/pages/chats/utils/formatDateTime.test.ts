import {describe, expect, it} from "vitest"
import {formatDateTimeMilliseconds, formatDateTimeSeconds} from "./formatDateTime"

describe("formatDateTimeSeconds / formatDateTimeMilliseconds", () => {
  it("formats without milliseconds when using seconds formatter", () => {
    const ts = Date.UTC(2024, 0, 2, 3, 4, 5, 123)
    const formatted = formatDateTimeSeconds(ts, {timeZone: "UTC"})
    expect(formatted).toBe("01/02/2024, 03:04:05")
    expect(formatted).not.toMatch(/\.[0-9]{3}\b/)
  })

  it("includes milliseconds when using millisecond formatter", () => {
    const ts = Date.UTC(2024, 0, 2, 3, 4, 5, 123)
    const formatted = formatDateTimeMilliseconds(ts, {timeZone: "UTC"})
    expect(formatted).toBe("01/02/2024, 03:04:05.123")
    expect(formatted).toMatch(/\.123\b/)
  })
})
