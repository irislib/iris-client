import {describe, expect, it} from "vitest"
import {isHashtreeBlobRequest, resolveNotificationClickUrl} from "./serviceWorkerRoutes"

function match(url: string, method = "GET") {
  return isHashtreeBlobRequest({
    request: new Request(url, {method}),
    url: new URL(url),
  })
}

describe("isHashtreeBlobRequest", () => {
  it("matches immutable hashtree blobs on the public read origin", () => {
    expect(
      match(
        "https://cdn.iris.to/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.bin"
      )
    ).toBe(true)
  })

  it("rejects non-blob paths and mutable endpoints", () => {
    expect(match("https://cdn.iris.to/index.html")).toBe(false)
    expect(match("https://cdn.iris.to/upload")).toBe(false)
    expect(match("https://cdn.iris.to/not-a-hash.bin")).toBe(false)
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

describe("resolveNotificationClickUrl", () => {
  const origin = "https://iris.to"

  it("resolves direct and nested notification URLs against the app origin", () => {
    expect(resolveNotificationClickUrl({url: "/chats"}, origin)).toBe(
      "https://iris.to/chats"
    )
    expect(resolveNotificationClickUrl({event: {url: "notifications"}}, origin)).toBe(
      "https://iris.to/notifications"
    )
  })

  it("preserves search and hash while keeping full URLs on the app origin", () => {
    expect(
      resolveNotificationClickUrl(
        {url: "https://example.com/chats?tab=requests#latest"},
        origin
      )
    ).toBe("https://iris.to/chats?tab=requests#latest")
  })

  it("falls back to the app root for missing or non-web notification URLs", () => {
    expect(resolveNotificationClickUrl({}, origin)).toBe("https://iris.to/")
    expect(resolveNotificationClickUrl({url: "mailto:test@example.com"}, origin)).toBe(
      "https://iris.to/"
    )
  })

  it("uses a caller-provided fallback route when the payload lacks a usable URL", () => {
    expect(
      resolveNotificationClickUrl({event: {kind: 1}}, origin, "/notifications")
    ).toBe("https://iris.to/notifications")
  })
})
