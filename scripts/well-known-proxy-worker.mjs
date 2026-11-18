const WELL_KNOWN_ORIGIN = "https://api.iris.to"

function forwardedScheme(request) {
  const forwardedProto = request.headers.get("x-forwarded-proto")
  if (forwardedProto) return forwardedProto.toLowerCase()

  const visitor = request.headers.get("cf-visitor")
  if (!visitor) return ""
  try {
    const parsed = JSON.parse(visitor)
    return typeof parsed.scheme === "string" ? parsed.scheme.toLowerCase() : ""
  } catch {
    return ""
  }
}

function shouldRedirectToHttps(request, url) {
  const scheme = forwardedScheme(request)
  if (request.cf && !request.cf.tlsVersion) return true
  return scheme === "http" || (!scheme && url.protocol === "http:")
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (shouldRedirectToHttps(request, url)) {
      url.protocol = "https:"
      url.port = ""
      return Response.redirect(url.toString(), 308)
    }

    if (url.pathname.startsWith("/.well-known/")) {
      const upstreamUrl = new URL(`${url.pathname}${url.search}`, WELL_KNOWN_ORIGIN)
      return fetch(new Request(upstreamUrl, request))
    }

    if (request.method === "GET" || request.method === "HEAD") {
      if (url.pathname === "/old") {
        url.pathname = "/old/"
        return Response.redirect(url.toString(), 308)
      }
      if (url.pathname.startsWith("/old/")) {
        const assetPath = url.pathname.slice("/old".length)
        // Keep the scoped app's offline shell on /old/ when Assets canonicalizes index.html.
        url.pathname = assetPath === "/index.html" ? "/" : assetPath
        return env.ASSETS.fetch(new Request(url, request))
      }
    }

    // Cloudflare Assets already handles index canonicalization and SPA fallbacks.
    return env.ASSETS.fetch(request)
  },
}
