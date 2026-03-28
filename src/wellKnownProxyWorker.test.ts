import {describe, expect, it, vi} from "vitest"

// @ts-expect-error Worker source is imported directly for a focused regression test.
import worker from "../scripts/well-known-proxy-worker.mjs"

describe("static assets worker", () => {
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
