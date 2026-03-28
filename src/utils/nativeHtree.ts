declare global {
  interface Window {
    __HTREE_SERVER_URL__?: string
    __HTREE_CANONICAL_URL__?: string | null
  }
}

const INTERNAL_HTREE_QUERY_PARAMS = new Set([
  "htree_c",
  "iris_htree_server",
  "iris_htree_canonical",
  "iris_htree_root",
])

function getQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null
  try {
    const value = new URLSearchParams(window.location.search).get(name)
    return typeof value === "string" ? value.trim() || null : null
  } catch {
    return null
  }
}

export function getInjectedHtreeServerUrl(): string | null {
  if (typeof window === "undefined") return null

  const injected =
    typeof window.__HTREE_SERVER_URL__ === "string" ? window.__HTREE_SERVER_URL__ : null
  const fallback = getQueryParam("iris_htree_server")
  const candidate = injected?.trim() || fallback

  if (!candidate) return null
  return candidate.replace(/\/$/, "")
}

function trimToNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function stripInternalHtreeSearch(search: string): string {
  const rawSearch = search.startsWith("?") ? search.slice(1) : search
  if (!rawSearch) return ""

  try {
    const params = new URLSearchParams(rawSearch)
    INTERNAL_HTREE_QUERY_PARAMS.forEach((param) => params.delete(param))
    const next = params.toString()
    return next ? `?${next}` : ""
  } catch {
    return ""
  }
}

function normalizePathname(pathname: string): string {
  const rawPathname = pathname.trim()
  let nextPathname = rawPathname || "/"

  if (!nextPathname.startsWith("/")) {
    nextPathname = `/${nextPathname}`
  }

  nextPathname = nextPathname.replace(/\/{2,}/g, "/")

  if (nextPathname !== "/") {
    nextPathname = nextPathname.replace(/\/+$/, "")
  }

  if (nextPathname === "/index.html") {
    return "/"
  }

  return nextPathname || "/"
}

function combinePathAndSearch(pathname: string, search: string = ""): string {
  return `${normalizePathname(pathname)}${search}`
}

function combineBrowserPathAndSearch(pathname: string, search: string = ""): string {
  const nextPathname = pathname || "/"
  return `${nextPathname}${search}`
}

function splitPathAndSearch(path: string): {pathname: string; search: string} {
  const trimmedPath = path.trim() || "/"
  const queryIndex = trimmedPath.indexOf("?")
  if (queryIndex === -1) {
    return {pathname: trimmedPath, search: ""}
  }

  return {
    pathname: trimmedPath.slice(0, queryIndex) || "/",
    search: trimmedPath.slice(queryIndex),
  }
}

function parseCanonicalHtreeAppPath(url: string): string | null {
  if (!url.startsWith("htree://")) return null

  const rest = url.slice("htree://".length)
  const hashless = rest.split("#", 1)[0]
  const separatorMatch = hashless.match(/[/?]/)
  const separatorIndex = separatorMatch?.index ?? -1
  const host = separatorIndex === -1 ? hashless : hashless.slice(0, separatorIndex)
  const pathAndQuery = separatorIndex === -1 ? "" : hashless.slice(separatorIndex)
  const queryIndex = pathAndQuery.indexOf("?")
  const rawPath = queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex)
  const search = queryIndex === -1 ? "" : `?${pathAndQuery.slice(queryIndex + 1)}`
  const pathSegments = rawPath.split("/").filter(Boolean)

  let appPathSegments: string[] = []

  if (host.startsWith("npub1") || host === "self") {
    appPathSegments = pathSegments.slice(1)
  } else if (host.startsWith("nhash1")) {
    appPathSegments = pathSegments
  } else {
    return null
  }

  const pathname =
    appPathSegments.length > 0
      ? `/${appPathSegments.map(decodePathSegment).join("/")}`
      : "/"

  return combinePathAndSearch(pathname, search)
}

function parseActualLoopbackAppPath(pathname: string): {
  appPath: string
  historyRootPath: string
} | null {
  const rawSegments = pathname.split("/").filter(Boolean)

  if (rawSegments[0] !== "htree") return null

  const host = rawSegments[1]
  if (!host) return null

  if (host.startsWith("npub1") || host === "self") {
    const treeName = rawSegments[2]
    if (!treeName) return null

    const appSegments = rawSegments.slice(3).map(decodePathSegment)
    const appPath = appSegments.length > 0 ? `/${appSegments.join("/")}` : "/"

    return {
      appPath: normalizePathname(appPath),
      historyRootPath: `/${rawSegments.slice(0, 3).join("/")}`,
    }
  }

  if (host.startsWith("nhash1")) {
    const appSegments = rawSegments.slice(2).map(decodePathSegment)
    const appPath = appSegments.length > 0 ? `/${appSegments.join("/")}` : "/"

    return {
      appPath: normalizePathname(appPath),
      historyRootPath: `/${rawSegments.slice(0, 2).join("/")}`,
    }
  }

  return null
}

function hasCanonicalHtreeIdentity(): boolean {
  const canonical = getInjectedHtreeCanonicalUrl()
  return typeof canonical === "string" && canonical.toLowerCase().startsWith("htree://")
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname.endsWith(".htree.localhost")
  )
}

export function isInjectedHtreeChildRuntime(): boolean {
  if (typeof window === "undefined") return false

  const protocol = window.location.protocol?.toLowerCase() || ""
  const hostname = window.location.hostname?.toLowerCase() || ""
  const actualHtreePath = parseActualLoopbackAppPath(window.location.pathname || "/")

  if (hasCanonicalHtreeIdentity()) return true
  if (actualHtreePath && (protocol === "http:" || protocol === "https:")) return true

  if (getInjectedHtreeServerUrl()) {
    if (protocol === "htree:") return true
    if (protocol === "http:" && isLoopbackHost(hostname)) return true
  }

  return false
}

export function getInjectedHtreeCanonicalUrl(): string | null {
  if (typeof window === "undefined") return null

  const injected = trimToNull(window.__HTREE_CANONICAL_URL__)
  if (injected) {
    return injected
  }

  return getQueryParam("iris_htree_canonical")
}

export function getInjectedHtreeRuntimeLocation(): {
  appPath: string
  browserPath: string
  historyRootPath: string
} | null {
  if (typeof window === "undefined") return null
  if (!isInjectedHtreeChildRuntime()) return null

  const strippedSearch = stripInternalHtreeSearch(window.location.search || "")
  const actualBrowserPath = combineBrowserPathAndSearch(
    window.location.pathname || "/",
    strippedSearch
  )
  const actualLoopbackPath = parseActualLoopbackAppPath(window.location.pathname || "/")
  const canonicalPath = parseCanonicalHtreeAppPath(getInjectedHtreeCanonicalUrl() || "")

  return {
    appPath:
      canonicalPath ||
      combinePathAndSearch(
        actualLoopbackPath?.appPath || window.location.pathname || "/",
        strippedSearch
      ),
    browserPath: actualBrowserPath,
    historyRootPath: actualLoopbackPath?.historyRootPath || "",
  }
}

export function toInjectedHtreeBrowserPath(
  appPath: string,
  historyRootPath: string = ""
): string {
  const {pathname, search} = splitPathAndSearch(appPath)
  const normalizedPathname = normalizePathname(pathname)

  if (!historyRootPath) {
    return `${normalizedPathname}${search}`
  }

  const nextPathname =
    normalizedPathname === "/"
      ? `${historyRootPath}/`
      : `${historyRootPath}${normalizedPathname}`

  return `${nextPathname}${search}`
}

export function getInjectedHtreeRelayUrl(): string | null {
  const serverUrl = getInjectedHtreeServerUrl()
  if (!serverUrl) return null

  try {
    const url = new URL(serverUrl)
    if (url.protocol === "http:") {
      url.protocol = "ws:"
    } else if (url.protocol === "https:") {
      url.protocol = "wss:"
    } else {
      return null
    }
    url.pathname = "/ws"
    url.search = ""
    url.hash = ""
    return url.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}
