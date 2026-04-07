import {afterEach, describe, expect, it, vi} from "vitest"

function installWindow({
  protocol = "https:",
  hostname = "iris.to",
  pathname = "/",
  search = "",
  serverUrl,
  canonicalUrl,
  sessionToken,
  tauri = false,
}: {
  protocol?: string
  hostname?: string
  pathname?: string
  search?: string
  serverUrl?: string
  canonicalUrl?: string
  sessionToken?: string
  tauri?: boolean
} = {}) {
  vi.stubGlobal("window", {
    location: {
      protocol,
      hostname,
      pathname,
      search,
    },
    ...(serverUrl ? {__HTREE_SERVER_URL__: serverUrl} : {}),
    ...(canonicalUrl ? {__HTREE_CANONICAL_URL__: canonicalUrl} : {}),
    ...(sessionToken ? {__HTREE_SESSION_TOKEN__: sessionToken} : {}),
    ...(tauri ? {__TAURI__: {}} : {}),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe("native htree runtime helpers", () => {
  it("derives the embedded daemon relay url from the injected server url", async () => {
    installWindow({
      protocol: "http:",
      hostname: "tree-example.htree.localhost",
      pathname: "/",
      search:
        "?iris_htree_canonical=htree%3A%2F%2Fnpub1example%2Firis-client%2Findex.html",
      serverUrl: "http://127.0.0.1:21417/",
      sessionToken: "session-token",
    })

    const {getInjectedHtreeRelayUrl, isInjectedHtreeChildRuntime} =
      await import("./nativeHtree")

    expect(isInjectedHtreeChildRuntime()).toBe(true)
    expect(getInjectedHtreeRelayUrl()).toBe(
      "ws://127.0.0.1:21417/__iris_relay?sessionToken=session-token"
    )
  })

  it("falls back to query params when the injected global is unavailable", async () => {
    installWindow({
      protocol: "http:",
      hostname: "tree-example.htree.localhost",
      pathname: "/",
      search:
        "?iris_htree_server=http%3A%2F%2F127.0.0.1%3A21417&iris_htree_canonical=htree%3A%2F%2Fnpub1example%2Firis-client%2Findex.html&iris_htree_session=session-token",
    })

    const {getInjectedHtreeServerUrl, getInjectedHtreeRelayUrl} =
      await import("./nativeHtree")

    expect(getInjectedHtreeServerUrl()).toBe("http://127.0.0.1:21417")
    expect(getInjectedHtreeRelayUrl()).toBe(
      "ws://127.0.0.1:21417/__iris_relay?sessionToken=session-token"
    )
  })

  it("falls back to the generic daemon websocket when no session token is injected", async () => {
    installWindow({
      protocol: "http:",
      hostname: "tree-example.htree.localhost",
      pathname: "/",
      serverUrl: "http://127.0.0.1:21417/",
      canonicalUrl: "htree://npub1example/iris-client/index.html",
    })

    const {getInjectedHtreeRelayUrl} = await import("./nativeHtree")

    expect(getInjectedHtreeRelayUrl()).toBe("ws://127.0.0.1:21417/ws")
  })

  it("uses the generic daemon websocket when query params omit the session token", async () => {
    installWindow({
      protocol: "http:",
      hostname: "tree-example.htree.localhost",
      pathname: "/",
      search:
        "?iris_htree_server=http%3A%2F%2F127.0.0.1%3A21417&iris_htree_canonical=htree%3A%2F%2Fnpub1example%2Firis-client%2Findex.html",
    })

    const {getInjectedHtreeRelayUrl} = await import("./nativeHtree")

    expect(getInjectedHtreeRelayUrl()).toBe("ws://127.0.0.1:21417/ws")
  })

  it("does not treat a regular Tauri window as an htree child runtime", async () => {
    installWindow({
      protocol: "tauri:",
      hostname: "localhost",
      tauri: true,
    })

    const {isInjectedHtreeChildRuntime} = await import("./nativeHtree")

    expect(isInjectedHtreeChildRuntime()).toBe(false)
  })

  it("ignores stray Tauri globals when detecting the injected htree runtime", async () => {
    installWindow({
      protocol: "http:",
      hostname: "tree-example.htree.localhost",
      pathname: "/",
      search:
        "?iris_htree_server=http%3A%2F%2F127.0.0.1%3A21417&iris_htree_canonical=htree%3A%2F%2Fnpub1example%2Firis-client%2Findex.html",
      tauri: true,
    })

    const {isInjectedHtreeChildRuntime} = await import("./nativeHtree")

    expect(isInjectedHtreeChildRuntime()).toBe(true)
  })

  it("maps the canonical tree root to the app root", async () => {
    installWindow({
      protocol: "http:",
      hostname: "tree-example.htree.localhost",
      pathname: "/",
      serverUrl: "http://127.0.0.1:21417/",
      canonicalUrl: "htree://npub1example/iris-client-dev/",
    })

    const {getInjectedHtreeRuntimeLocation, toInjectedHtreeBrowserPath} =
      await import("./nativeHtree")

    const location = getInjectedHtreeRuntimeLocation()

    expect(location).toEqual({
      appPath: "/",
      browserPath: "/",
      historyRootPath: "",
    })
    expect(toInjectedHtreeBrowserPath("/", location?.historyRootPath)).toBe("/")
  })

  it("strips the tree prefix and index.html from plain loopback child urls", async () => {
    installWindow({
      protocol: "http:",
      hostname: "127.0.0.1",
      pathname: "/htree/npub1example/iris-client-dev/index.html",
      search:
        "?iris_htree_server=http%3A%2F%2F127.0.0.1%3A21417&iris_htree_canonical=htree%3A%2F%2Fnpub1example%2Firis-client-dev%2Findex.html",
    })

    const {getInjectedHtreeRuntimeLocation, toInjectedHtreeBrowserPath} =
      await import("./nativeHtree")

    const location = getInjectedHtreeRuntimeLocation()

    expect(location).toEqual({
      appPath: "/",
      browserPath: "/htree/npub1example/iris-client-dev/index.html",
      historyRootPath: "/htree/npub1example/iris-client-dev",
    })
    expect(
      toInjectedHtreeBrowserPath("/settings?tab=network", location?.historyRootPath)
    ).toBe("/htree/npub1example/iris-client-dev/settings?tab=network")
  })

  it("preserves the trailing slash for real tree-root browser urls", async () => {
    installWindow({
      protocol: "http:",
      hostname: "127.0.0.1",
      pathname: "/htree/npub1example/iris-client-dev/",
      search:
        "?iris_htree_server=http%3A%2F%2F127.0.0.1%3A21417&iris_htree_canonical=htree%3A%2F%2Fnpub1example%2Firis-client-dev%2F",
    })

    const {getInjectedHtreeRuntimeLocation, toInjectedHtreeBrowserPath} =
      await import("./nativeHtree")

    const location = getInjectedHtreeRuntimeLocation()

    expect(location).toEqual({
      appPath: "/",
      browserPath: "/htree/npub1example/iris-client-dev/",
      historyRootPath: "/htree/npub1example/iris-client-dev",
    })
    expect(toInjectedHtreeBrowserPath("/", location?.historyRootPath)).toBe(
      "/htree/npub1example/iris-client-dev/"
    )
  })

  it("treats public /htree child paths as embedded runtimes even without injected globals", async () => {
    installWindow({
      protocol: "https:",
      hostname: "site-example.hashtree.cc",
      pathname: "/htree/npub1example/iris-client-site/index.html",
      search: "?htree_c=1234abcd",
    })

    const {
      getInjectedHtreeRuntimeLocation,
      isInjectedHtreeChildRuntime,
      resolveAppAssetUrl,
      toInjectedHtreeBrowserPath,
    } = await import("./nativeHtree")

    expect(isInjectedHtreeChildRuntime()).toBe(true)
    expect(getInjectedHtreeRuntimeLocation()).toEqual({
      appPath: "/",
      browserPath: "/htree/npub1example/iris-client-site/index.html",
      historyRootPath: "/htree/npub1example/iris-client-site",
    })
    expect(resolveAppAssetUrl("/img/icon128.png")).toBe(
      "/htree/npub1example/iris-client-site/img/icon128.png"
    )
    expect(
      toInjectedHtreeBrowserPath(
        "/settings?tab=network",
        "/htree/npub1example/iris-client-site"
      )
    ).toBe("/htree/npub1example/iris-client-site/settings?tab=network")
  })

  it("uses the canonical htree path for nested in-app routes", async () => {
    installWindow({
      protocol: "http:",
      hostname: "tree-example.htree.localhost",
      pathname: "/settings",
      search:
        "?tab=wrong&iris_htree_server=http%3A%2F%2F127.0.0.1%3A21417&iris_htree_canonical=htree%3A%2F%2Fnpub1example%2Firis-client-dev%2Fsettings%3Ftab%3Dnetwork",
    })

    const {getInjectedHtreeRuntimeLocation} = await import("./nativeHtree")

    expect(getInjectedHtreeRuntimeLocation()).toEqual({
      appPath: "/settings?tab=network",
      browserPath: "/settings?tab=wrong",
      historyRootPath: "",
    })
  })

  it("keeps resolving app assets after a loopback child route drops the tree prefix", async () => {
    installWindow({
      protocol: "http:",
      hostname: "127.0.0.1",
      pathname: "/htree/nhash1example/index.html",
      search: "?iris_htree_server=http%3A%2F%2F127.0.0.1%3A21417",
      serverUrl: "http://127.0.0.1:21417/",
    })

    const {getInjectedHtreeRuntimeLocation, resolveAppAssetUrl} =
      await import("./nativeHtree")

    expect(getInjectedHtreeRuntimeLocation()).toEqual({
      appPath: "/",
      browserPath: "/htree/nhash1example/index.html",
      historyRootPath: "/htree/nhash1example",
    })
    expect(resolveAppAssetUrl("/img/icon128.png")).toBe(
      "/htree/nhash1example/img/icon128.png"
    )

    window.location.pathname = "/npub1publisher"
    window.location.search = "?iris_htree_server=http%3A%2F%2F127.0.0.1%3A21417"

    expect(getInjectedHtreeRuntimeLocation()).toEqual({
      appPath: "/npub1publisher",
      browserPath: "/npub1publisher",
      historyRootPath: "/htree/nhash1example",
    })
    expect(resolveAppAssetUrl("/img/icon128.png")).toBe(
      "/htree/nhash1example/img/icon128.png"
    )
  })

  it("rewrites head asset links to the remembered tree root", async () => {
    installWindow({
      protocol: "http:",
      hostname: "127.0.0.1",
      pathname: "/htree/nhash1example/index.html",
      search: "?iris_htree_server=http%3A%2F%2F127.0.0.1%3A21417",
      serverUrl: "http://127.0.0.1:21417/",
    })

    const {getInjectedHtreeRuntimeLocation, syncInjectedHtreeHeadAssetUrls} =
      await import("./nativeHtree")

    expect(getInjectedHtreeRuntimeLocation()).toEqual({
      appPath: "/",
      browserPath: "/htree/nhash1example/index.html",
      historyRootPath: "/htree/nhash1example",
    })

    const iconLink = {href: "./favicon.png"}
    const appleLink = {href: "./img/apple-touch-icon.png"}
    const manifestLink = {href: "./manifest.json"}
    const fakeDocument = {
      querySelector: vi.fn((selector: string) => {
        if (selector === 'link[rel="icon"]') return iconLink
        if (selector === 'link[rel="apple-touch-icon"]') return appleLink
        if (selector === 'link[rel="manifest"]') return manifestLink
        return null
      }),
    } as unknown as Document

    window.location.pathname = "/npub1publisher"
    window.location.search = "?iris_htree_server=http%3A%2F%2F127.0.0.1%3A21417"

    syncInjectedHtreeHeadAssetUrls(fakeDocument)

    expect(iconLink.href).toBe("/htree/nhash1example/favicon.png")
    expect(appleLink.href).toBe("/htree/nhash1example/img/apple-touch-icon.png")
    expect(manifestLink.href).toBe("/htree/nhash1example/manifest.json")
  })

  it("leaves regular and external asset urls unchanged", async () => {
    installWindow()

    const {resolveAppAssetUrl} = await import("./nativeHtree")

    expect(resolveAppAssetUrl("/img/icon128.png")).toBe("/img/icon128.png")
    expect(resolveAppAssetUrl("https://example.com/logo.png")).toBe(
      "https://example.com/logo.png"
    )
  })
})
