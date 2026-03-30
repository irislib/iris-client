import {describe, expect, it} from "vitest"
import {
  LEGACY_IRIS_BLOSSOM_URL,
  getDefaultServers,
  MEDIASERVERS,
} from "./mediaservers-utils"

describe("getDefaultServers", () => {
  it("uses upload.iris.to for subscriber defaults", () => {
    const defaults = getDefaultServers(true)

    expect(defaults[0]).toEqual(MEDIASERVERS.iris)
    expect(defaults[0].url).toBe("https://upload.iris.to")
    expect(defaults.some((server) => server.url === LEGACY_IRIS_BLOSSOM_URL)).toBe(false)
  })

  it("keeps non-subscribers off the iris upload worker by default", () => {
    const defaults = getDefaultServers(false)

    expect(defaults[0]).toEqual(MEDIASERVERS.blossom_band)
    expect(defaults.some((server) => server.url === "https://upload.iris.to")).toBe(false)
    expect(defaults.some((server) => server.url === LEGACY_IRIS_BLOSSOM_URL)).toBe(false)
  })
})
