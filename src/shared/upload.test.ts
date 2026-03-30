import {describe, expect, it} from "vitest"
import {getUploadServerAttemptOrder} from "./upload"

describe("getUploadServerAttemptOrder", () => {
  it("keeps the default server first and removes duplicates", () => {
    const defaultServer = {url: "https://upload.iris.to", protocol: "blossom" as const}
    const ordered = getUploadServerAttemptOrder(defaultServer, [
      {url: "https://blossom.band", protocol: "blossom" as const},
      defaultServer,
      {url: "https://cdn.nostrcheck.me", protocol: "nip96" as const},
    ])

    expect(ordered).toEqual([
      defaultServer,
      {url: "https://blossom.band", protocol: "blossom" as const},
      {url: "https://cdn.nostrcheck.me", protocol: "nip96" as const},
    ])
  })

  it("returns the remaining configured servers when there is no default", () => {
    expect(
      getUploadServerAttemptOrder(null, [
        {url: "https://blossom.band", protocol: "blossom" as const},
        {url: "https://blossom.primal.net", protocol: "blossom" as const},
      ])
    ).toEqual([
      {url: "https://blossom.band", protocol: "blossom" as const},
      {url: "https://blossom.primal.net", protocol: "blossom" as const},
    ])
  })
})
