import {afterEach, describe, expect, it, vi} from "vitest"

function installWindow({
  protocol = "https:",
  hostname = "iris.to",
  pathname = "/",
  search = "",
  serverUrl,
  canonicalUrl,
  tauri = false,
}: {
  protocol?: string
  hostname?: string
  pathname?: string
  search?: string
  serverUrl?: string
  canonicalUrl?: string
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
    })

    const {getInjectedHtreeRelayUrl, isInjectedHtreeChildRuntime} =
      await import("./nativeHtree")

    expect(isInjectedHtreeChildRuntime()).toBe(true)
    expect(getInjectedHtreeRelayUrl()).toBe("ws://127.0.0.1:21417/ws")
  })

  it("falls back to query params when the injected global is unavailable", async () => {
    installWindow({
      protocol: "http:",
      hostname: "tree-example.htree.localhost",
      pathname: "/",
      search:
        "?iris_htree_server=http%3A%2F%2F127.0.0.1%3A21417&iris_htree_canonical=htree%3A%2F%2Fnpub1example%2Firis-client%2Findex.html",
    })

    const {getInjectedHtreeServerUrl, getInjectedHtreeRelayUrl} =
      await import("./nativeHtree")

    expect(getInjectedHtreeServerUrl()).toBe("http://127.0.0.1:21417")
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
})
