import {afterEach, describe, expect, it, vi} from "vitest"

import {buildIrisUsernameRedirectPath} from "./profileRoute"

function installWindow({
  protocol = "https:",
  hostname = "site-example.hashtree.cc",
  pathname = "/htree/npub1example/iris-client-site/index.html",
  search = "?htree_c=1234abcd",
}: {
  protocol?: string
  hostname?: string
  pathname?: string
  search?: string
} = {}) {
  vi.stubGlobal("window", {
    location: {
      protocol,
      hostname,
      pathname,
      search,
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe("buildIrisUsernameRedirectPath", () => {
  it("preserves nested profile tabs when redirecting an iris.to user", () => {
    expect(
      buildIrisUsernameRedirectPath(
        "/npub1trr5r2nrpsk6xkjk5a7p6pfcryyt6yzsflwjmz6r7uj7lfkjxxtq78hdpu/zaps",
        "sirius@iris.to"
      )
    ).toBe("/sirius/zaps")
  })

  it("does not redirect when the username route is already active", () => {
    expect(buildIrisUsernameRedirectPath("/sirius", "sirius@iris.to")).toBeNull()
  })

  it("ignores placeholder iris usernames", () => {
    expect(
      buildIrisUsernameRedirectPath(
        "/npub1trr5r2nrpsk6xkjk5a7p6pfcryyt6yzsflwjmz6r7uj7lfkjxxtq78hdpu",
        "_@iris.to"
      )
    ).toBeNull()
  })

  it("works with the stripped app path inside an embedded hashtree runtime", async () => {
    installWindow()
    const {getInjectedHtreeRuntimeLocation} = await import("@/utils/nativeHtree")

    const runtimeLocation = getInjectedHtreeRuntimeLocation()

    expect(runtimeLocation?.appPath).toBe("/")
    expect(
      buildIrisUsernameRedirectPath(
        "/npub1a4xq7y2r2c3s6a9ng9u0h6e4ssfjc5rqlw9rhd9j95v5m6s6tqms4c7f55",
        "sirius@iris.to"
      )
    ).toBe("/sirius")
  })
})
