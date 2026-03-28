import {afterEach, describe, expect, it, vi} from "vitest"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe("muteLabels", () => {
  it("keeps web wording even if Tauri globals are present", async () => {
    vi.stubGlobal("window", {
      location: {
        protocol: "https:",
        hostname: "iris.to",
        search: "",
      },
      __TAURI__: {},
    })

    const {getMuteLabel, getMutedLabel, getUnmuteLabel} = await import("./muteLabels")

    expect(getMuteLabel()).toBe("Mute")
    expect(getMutedLabel()).toBe("Muted")
    expect(getUnmuteLabel()).toBe("Unmute")
  })
})
