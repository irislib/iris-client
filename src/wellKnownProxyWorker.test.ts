import {describe, expect, it, vi} from "vitest"

// @ts-expect-error Worker source is imported directly for a focused regression test.
import worker from "../scripts/well-known-proxy-worker.mjs"

describe("static assets worker", () => {
  it("redirects plain HTTP requests to HTTPS before assets", async () => {
    const assetsFetch = vi.fn(async () => new Response("unexpected", {status: 500}))

    const response = await worker.fetch(new Request("http://iris.to/#/npub1demo"), {
      ASSETS: {
        fetch: assetsFetch,
      },
    })

    expect(response.status).toBe(308)
    expect(response.headers.get("location")).toBe("https://iris.to/#/npub1demo")
    expect(assetsFetch).not.toHaveBeenCalled()
  })

  it("proxies .well-known requests to the iris API", async () => {
    const upstreamFetch = vi.fn(async (request: Request) => {
      expect(request).toBeInstanceOf(Request)
      return new Response('{"names":{}}', {status: 200})
    })
    const assetsFetch = vi.fn(async () => new Response("unexpected", {status: 500}))
    const originalFetch = globalThis.fetch

    vi.stubGlobal("fetch", upstreamFetch)

    try {
      await worker.fetch(new Request("https://iris.to/.well-known/nostr.json?name=_"), {
        ASSETS: {
          fetch: assetsFetch,
        },
      })
    } finally {
      vi.stubGlobal("fetch", originalFetch)
    }

    expect(assetsFetch).not.toHaveBeenCalled()
    expect(upstreamFetch).toHaveBeenCalledTimes(1)
    const request = upstreamFetch.mock.calls[0]?.[0]
    expect(request).toBeDefined()
    expect(request!.url).toBe("https://api.iris.to/.well-known/nostr.json?name=_")
  })

  it("canonicalizes the recovery mount while retaining its search", async () => {
    const assetsFetch = vi.fn()
    const response = await worker.fetch(new Request("https://iris.to/old?ref=wallet"), {
      ASSETS: {fetch: assetsFetch},
    })
    expect(response.status).toBe(308)
    expect(response.headers.get("location")).toBe("https://iris.to/old/?ref=wallet")
    expect(assetsFetch).not.toHaveBeenCalled()
  })

  it.each([
    ["/old/", "/"],
    ["/old/index.html", "/"],
    ["/old/wallet", "/wallet"],
    ["/old/assets/chunk.js", "/assets/chunk.js"],
    ["/old-wallet", "/old-wallet"],
    ["/cashu/", "/cashu/"],
    ["/manifest.json", "/manifest.json"],
  ])("serves %s through the expected Assets path", async (path, assetPath) => {
    const assetFetch = vi.fn(async (_request: Request) => new Response(null))
    await worker.fetch(
      new Request(`https://iris.to${path}?ref=wallet`, {method: "HEAD"}),
      {
        ASSETS: {fetch: assetFetch},
      }
    )
    const request = assetFetch.mock.calls[0]?.[0]
    expect(request?.method).toBe("HEAD")
    expect(request?.url).toBe(`https://iris.to${assetPath}?ref=wallet`)
  })

  it("serves the non-caching Sites rollback bridge to the apex worker script request", async () => {
    const assetFetch = vi.fn(
      async (_request: Request) =>
        new Response("worker script", {headers: {"Content-Type": "text/javascript"}})
    )
    const response = await worker.fetch(
      new Request("https://iris.to/sw.js", {headers: {"Service-Worker": "script"}}),
      {ASSETS: {fetch: assetFetch}}
    )
    expect(assetFetch.mock.calls[0]?.[0]?.url).toBe(
      "https://iris.to/legacy-apex-service-worker.js"
    )
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(response.headers.get("Content-Type")).toBe("text/javascript")
    expect(await response.text()).toBe("worker script")
  })

  it.each([
    ["https://iris.to/sw.js", {}],
    ["https://beta.iris.to/sw.js", {"Service-Worker": "script"}],
    ["https://iris.to/service-worker.js", {"Service-Worker": "script"}],
    ["https://iris.to/old/service-worker.js", {"Service-Worker": "script"}],
  ])("leaves %s outside the Sites rollback bridge", async (url, headers) => {
    const assetFetch = vi.fn(async (_request: Request) => new Response(null))
    await worker.fetch(new Request(url, {headers}), {ASSETS: {fetch: assetFetch}})
    expect(assetFetch.mock.calls[0]?.[0]?.url).toBe(url.replace("/old/", "/"))
  })

  it("passes root requests through to Cloudflare Assets", async () => {
    Object.defineProperty(globalThis, "HTMLRewriter", {
      configurable: true,
      writable: true,
      value: class {
        on() {
          return this
        }

        transform(response: Response) {
          return response
        }
      },
    })

    const assetFetch = vi.fn(async (request: Request) => {
      expect(request).toBeInstanceOf(Request)
      return new Response("<!doctype html>", {status: 200})
    })

    await worker.fetch(new Request("https://iris-client.irisapp.workers.dev/"), {
      ASSETS: {
        fetch: assetFetch,
      },
    })

    expect(assetFetch).toHaveBeenCalledTimes(1)
    const request = assetFetch.mock.calls[0]?.[0]
    expect(request).toBeDefined()
    expect(new URL(request!.url).pathname).toBe("/")
  })
})
