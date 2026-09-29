import {createHmac} from "node:crypto"
import {describe, expect, it} from "vitest"
import {generateProxyUrl} from "./imgproxy"

describe("generateProxyUrl", () => {
  it.each(["data:image/png;base64,aGVsbG8=", "blob:https://iris.to/local-avatar"])(
    "keeps an in-memory image local even when resizing: %s",
    (source) => {
      expect(generateProxyUrl(source, {width: 45, square: true})).toBe(source)
    }
  )

  it("keeps imgproxy HMAC signatures stable with Noble v2", () => {
    const original = "https://example.com/image.jpg"
    const key = "11".repeat(32)
    const salt = "22".repeat(32)
    const encoded = Buffer.from(original).toString("base64url")
    const path = `/rs:fit:320:320/dpr:2/${encoded}`
    const signature = createHmac("sha256", Buffer.from(key, "hex"))
      .update(Buffer.from(salt, "hex"))
      .update(path)
      .digest("base64url")

    expect(
      generateProxyUrl(original, {width: 320}, {url: "https://img.test", key, salt})
    ).toBe(`https://img.test/${signature}${path}`)
  })
})
