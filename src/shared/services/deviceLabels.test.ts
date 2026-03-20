import {describe, expect, it} from "vitest"

import {
  describeManagedDevice,
  getLinkedDeviceRegistrationLabels,
  inferBrowserDeviceLabel,
} from "./deviceLabels"

describe("deviceLabels", () => {
  it("prefers the encrypted device label and keeps client metadata in the subtitle", () => {
    const pubkey = "6b911f0f1ca34f7f6a9f2f7a7d8aa0c92e3f0f0d6bb64abd0c4f2e55d8f67f1f"

    const display = describeManagedDevice(pubkey, {
      deviceLabel: "Sirius MacBook",
      clientLabel: "Iris Client Desktop",
    })

    expect(display.title).toBe("Sirius MacBook")
    expect(display.subtitle).toContain("Iris Client Desktop")
    expect(display.subtitle).toContain("npub1")
  })

  it("falls back to the client label when only that label is available", () => {
    const pubkey = "1f1e1d1c1b1a19181716151413121110ffeeddccbbaa99887766554433221100"

    const display = describeManagedDevice(pubkey, {
      clientLabel: "Iris Client Web",
    })

    expect(display.title).toBe("Iris Client Web")
    expect(display.subtitle).toContain("npub1")
  })

  it("derives a browser-style label from the user agent", () => {
    expect(
      inferBrowserDeviceLabel(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
      )
    ).toBe("Chrome on Mac")
  })

  it("uses a generic label for linked devices", async () => {
    await expect(getLinkedDeviceRegistrationLabels()).resolves.toEqual({
      deviceLabel: "Linked device",
      clientLabel: "Iris Client",
    })
  })
})
