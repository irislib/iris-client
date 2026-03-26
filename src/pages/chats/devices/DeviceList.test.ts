/** @vitest-environment jsdom */

import React, {act} from "react"
import {createRoot, Root} from "react-dom/client"
import {nip19} from "nostr-tools"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import DeviceList from "./DeviceList"

const mocks = vi.hoisted(() => ({
  devicesStore: {
    identityPubkey: null as string | null,
    registeredDevices: [] as Array<{identityPubkey: string; createdAt: number}>,
  },
  appKeysManager: {
    getDeviceLabels: vi
      .fn<
        (
          identityPubkey: string
        ) => {deviceLabel?: string; clientLabel?: string} | undefined
      >()
      .mockReturnValue(undefined),
  },
}))

vi.mock("@/stores/devices", () => ({
  useDevicesStore: () => mocks.devicesStore,
}))

vi.mock("@/shared/services/PrivateChats", () => ({
  republishInvite: vi.fn(),
  prepareRevocation: vi.fn(),
  publishPreparedRevocation: vi.fn(),
  refreshOwnAppKeysFromRelay: vi.fn(),
  getAppKeysManager: () => mocks.appKeysManager,
}))

describe("DeviceList", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}
    ).IS_REACT_ACT_ENVIRONMENT = true

    if (typeof HTMLDialogElement !== "undefined") {
      HTMLDialogElement.prototype.showModal = vi.fn()
      HTMLDialogElement.prototype.close = vi.fn()
    }

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    mocks.devicesStore = {
      identityPubkey: null,
      registeredDevices: [],
    }
    mocks.appKeysManager.getDeviceLabels.mockReset()
    mocks.appKeysManager.getDeviceLabels.mockReturnValue(undefined)
  })

  it("shows all managed device keys as npub", async () => {
    const currentDevicePubkey =
      "6b911f0f1ca34f7f6a9f2f7a7d8aa0c92e3f0f0d6bb64abd0c4f2e55d8f67f1f"
    const siblingDevicePubkey =
      "1f1e1d1c1b1a19181716151413121110ffeeddccbbaa99887766554433221100"

    mocks.devicesStore = {
      identityPubkey: currentDevicePubkey,
      registeredDevices: [
        {identityPubkey: siblingDevicePubkey, createdAt: 1},
        {identityPubkey: currentDevicePubkey, createdAt: 2},
      ],
    }

    await act(async () => {
      root.render(React.createElement(DeviceList))
    })

    expect(container.textContent).toContain(nip19.npubEncode(currentDevicePubkey))
    expect(container.textContent).toContain(nip19.npubEncode(siblingDevicePubkey))
    expect(container.textContent).not.toContain(currentDevicePubkey)
    expect(container.textContent).not.toContain(siblingDevicePubkey)
  })

  it("renders owner-encrypted labels when available", async () => {
    const currentDevicePubkey =
      "6b911f0f1ca34f7f6a9f2f7a7d8aa0c92e3f0f0d6bb64abd0c4f2e55d8f67f1f"

    mocks.devicesStore = {
      identityPubkey: currentDevicePubkey,
      registeredDevices: [{identityPubkey: currentDevicePubkey, createdAt: 2}],
    }
    mocks.appKeysManager.getDeviceLabels.mockImplementation((pubkey: string) =>
      pubkey === currentDevicePubkey
        ? {deviceLabel: "Sirius MacBook", clientLabel: "Iris Client Desktop"}
        : undefined
    )

    await act(async () => {
      root.render(React.createElement(DeviceList))
    })

    expect(container.textContent).toContain("Sirius MacBook")
    expect(container.textContent).toContain("Iris Client Desktop")
  })
})
