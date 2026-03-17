import {afterEach, describe, expect, it} from "vitest"
import {useDevicesStore} from "./devices"

const resetStore = () => {
  useDevicesStore.setState({
    identityPubkey: null,
    registeredDevices: [],
    isCurrentDeviceRegistered: false,
    appKeysManagerReady: false,
    sessionManagerReady: false,
    hasLocalAppKeys: false,
    lastEventTimestamp: 0,
    pendingAutoRegistration: false,
    canSendPrivateMessages: false,
  })
}

describe("devices store", () => {
  afterEach(() => {
    resetStore()
  })

  it("accepts newer AppKeys updates", () => {
    useDevicesStore
      .getState()
      .setRegisteredDevices([{identityPubkey: "device-1", createdAt: 100}], 100)
    useDevicesStore.getState().setRegisteredDevices(
      [
        {identityPubkey: "device-1", createdAt: 100},
        {identityPubkey: "device-2", createdAt: 101},
      ],
      101
    )

    expect(useDevicesStore.getState().registeredDevices).toEqual([
      {identityPubkey: "device-1", createdAt: 100},
      {identityPubkey: "device-2", createdAt: 101},
    ])
    expect(useDevicesStore.getState().lastEventTimestamp).toBe(101)
  })

  it("accepts same-second AppKeys updates as an edge case", () => {
    useDevicesStore
      .getState()
      .setRegisteredDevices([{identityPubkey: "device-1", createdAt: 100}], 100)
    useDevicesStore.getState().setRegisteredDevices(
      [
        {identityPubkey: "device-1", createdAt: 100},
        {identityPubkey: "device-2", createdAt: 100},
      ],
      100
    )

    expect(useDevicesStore.getState().registeredDevices).toEqual([
      {identityPubkey: "device-1", createdAt: 100},
      {identityPubkey: "device-2", createdAt: 100},
    ])
    expect(useDevicesStore.getState().lastEventTimestamp).toBe(100)
  })

  it("ignores older AppKeys updates", () => {
    useDevicesStore
      .getState()
      .setRegisteredDevices([{identityPubkey: "device-2", createdAt: 101}], 101)
    useDevicesStore
      .getState()
      .setRegisteredDevices([{identityPubkey: "device-1", createdAt: 100}], 100)

    expect(useDevicesStore.getState().registeredDevices).toEqual([
      {identityPubkey: "device-2", createdAt: 101},
    ])
    expect(useDevicesStore.getState().lastEventTimestamp).toBe(101)
  })
})
