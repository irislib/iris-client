const WELL_KNOWN_ORIGIN = "https://api.iris.to"

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname.startsWith("/.well-known/")) {
      const upstreamUrl = new URL(`${url.pathname}${url.search}`, WELL_KNOWN_ORIGIN)
      return fetch(new Request(upstreamUrl, request))
    }

    // Cloudflare Assets already handles index canonicalization and SPA fallbacks.
    return env.ASSETS.fetch(request)
  },
}
