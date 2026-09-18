import {afterEach, describe, expect, it, vi} from "vitest"
import {onCurrentDeviceRemovedFromRoster, useDevicesStore} from "./devices"

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
    privateMessagingBlocked: false,
    canSendPrivateMessages: false,
  })
}

describe("devices store", () => {
  afterEach(() => {
    resetStore()
  })

  it("requires this device to be registered before sending, even with other devices or local keys", () => {
    const store = useDevicesStore.getState()
    store.setIdentityPubkey("device-1")
    store.setAppKeysManagerReady(true)
    store.setSessionManagerReady(true)
    store.setHasLocalAppKeys(true)
    store.setRegisteredDevices([{identityPubkey: "device-2", createdAt: 100}], 100)

    expect(useDevicesStore.getState().canSendPrivateMessages).toBe(false)

    store.setRegisteredDevices(
      [
        {identityPubkey: "device-1", createdAt: 101},
        {identityPubkey: "device-2", createdAt: 100},
      ],
      101
    )
    expect(useDevicesStore.getState().canSendPrivateMessages).toBe(true)

    store.setRegisteredDevices([{identityPubkey: "device-2", createdAt: 100}], 102)
    expect(useDevicesStore.getState().canSendPrivateMessages).toBe(false)
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

  it("reports when the current device disappears from a newer roster", () => {
    const removed = vi.fn()
    const unsubscribe = onCurrentDeviceRemovedFromRoster(removed)
    useDevicesStore.getState().setIdentityPubkey("device-1")
    useDevicesStore
      .getState()
      .setRegisteredDevices([{identityPubkey: "device-1", createdAt: 100}], 100)

    useDevicesStore
      .getState()
      .setRegisteredDevices([{identityPubkey: "device-2", createdAt: 101}], 101)

    expect(removed).toHaveBeenCalledOnce()
    expect(removed).toHaveBeenCalledWith("device-1")
    unsubscribe()
  })

  it("does not report a device that was never registered", () => {
    const removed = vi.fn()
    const unsubscribe = onCurrentDeviceRemovedFromRoster(removed)
    useDevicesStore.getState().setIdentityPubkey("device-1")

    useDevicesStore
      .getState()
      .setRegisteredDevices([{identityPubkey: "device-2", createdAt: 101}], 101)

    expect(removed).not.toHaveBeenCalled()
    unsubscribe()
  })
})
