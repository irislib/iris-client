import {describe, it, expect, vi, beforeEach} from "vitest"
import {useDevicesStore} from "@/stores/devices"
import {useUserStore} from "@/stores/user"

vi.mock("@/shared/services/PrivateChats", () => ({
  initAppKeysManager: vi.fn().mockResolvedValue(undefined),
  registerDevice: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/utils/createDebugLogger", () => ({
  createDebugLogger: () => ({log: vi.fn(), error: vi.fn()}),
}))

import {autoRegisterDevice} from "./autoRegisterDevice"
import {registerDevice, initAppKeysManager} from "@/shared/services/PrivateChats"

const resetStores = () => {
  useDevicesStore.setState({
    pendingAutoRegistration: false,
    identityPubkey: null,
    registeredDevices: [],
    isCurrentDeviceRegistered: false,
    appKeysManagerReady: false,
    sessionManagerReady: false,
    hasLocalAppKeys: false,
    lastEventTimestamp: 0,
    canSendPrivateMessages: false,
  })
  useUserStore.setState({
    publicKey: "",
    privateKey: "",
    linkedDevice: false,
  })
}

describe("autoRegisterDevice", () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it("skips when pendingAutoRegistration is false (sign-in path)", async () => {
    useUserStore.setState({publicKey: "abc123", privateKey: "def456"})

    await autoRegisterDevice()

    expect(registerDevice).not.toHaveBeenCalled()
  })

  it("registers device when pendingAutoRegistration is true (signup path)", async () => {
    useDevicesStore.getState().setPendingAutoRegistration(true)
    useUserStore.setState({publicKey: "abc123", privateKey: "def456"})

    await autoRegisterDevice()

    expect(initAppKeysManager).toHaveBeenCalled()
    expect(registerDevice).toHaveBeenCalledWith(2000)
  })

  it("clears the flag after running", async () => {
    useDevicesStore.getState().setPendingAutoRegistration(true)
    useUserStore.setState({publicKey: "abc123", privateKey: "def456"})

    await autoRegisterDevice()

    expect(useDevicesStore.getState().pendingAutoRegistration).toBe(false)
  })

  it("skips when device is already registered", async () => {
    useDevicesStore.getState().setPendingAutoRegistration(true)
    useDevicesStore.setState({isCurrentDeviceRegistered: true})
    useUserStore.setState({publicKey: "abc123", privateKey: "def456"})

    await autoRegisterDevice()

    expect(registerDevice).not.toHaveBeenCalled()
  })

  it("skips when hasLocalAppKeys is true", async () => {
    useDevicesStore.getState().setPendingAutoRegistration(true)
    useDevicesStore.setState({hasLocalAppKeys: true})
    useUserStore.setState({publicKey: "abc123", privateKey: "def456"})

    await autoRegisterDevice()

    expect(registerDevice).not.toHaveBeenCalled()
  })

  it("skips for linked devices", async () => {
    useDevicesStore.getState().setPendingAutoRegistration(true)
    useUserStore.setState({publicKey: "abc123", linkedDevice: true})

    await autoRegisterDevice()

    expect(registerDevice).not.toHaveBeenCalled()
  })

  it("skips when no public key", async () => {
    useDevicesStore.getState().setPendingAutoRegistration(true)

    await autoRegisterDevice()

    expect(registerDevice).not.toHaveBeenCalled()
  })
})
