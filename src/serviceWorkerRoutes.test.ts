import {describe, expect, it} from "vitest"
import {isHashtreeBlobRequest} from "./serviceWorkerRoutes"

function match(url: string, method = "GET") {
  return isHashtreeBlobRequest({
    request: new Request(url, {method}),
    url: new URL(url),
  })
}

describe("isHashtreeBlobRequest", () => {
  it("matches immutable hashtree blobs on the public read origins", () => {
    expect(
      match("https://cdn.iris.to/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.bin")
    ).toBe(true)
    expect(
      match(
        "https://hashtree.iris.to/abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd.bin"
      )
    ).toBe(true)
  })

  it("rejects non-blob paths and mutable endpoints", () => {
    expect(match("https://cdn.iris.to/index.html")).toBe(false)
    expect(match("https://hashtree.iris.to/upload")).toBe(false)
    expect(
      match("https://hashtree.iris.to/not-a-hash.bin")
    ).toBe(false)
  })

  it("rejects other origins and non-GET methods", () => {
    expect(
      match(
        "https://example.com/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.bin"
      )
    ).toBe(false)
    expect(
      match(
        "https://cdn.iris.to/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.bin",
        "PUT"
      )
    ).toBe(false)
  })
})
