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

  it("keeps setup pending until registration finishes and prevents duplicate attempts", async () => {
    let finishRegistration!: () => void
    vi.mocked(registerDevice).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRegistration = resolve
        })
    )
    useDevicesStore.getState().setPendingAutoRegistration(true)
    useUserStore.setState({publicKey: "abc123", privateKey: "def456"})

    const registration = autoRegisterDevice()
    await vi.waitFor(() => expect(registerDevice).toHaveBeenCalledOnce())
    expect(useDevicesStore.getState().pendingAutoRegistration).toBe(true)
    await autoRegisterDevice()
    expect(registerDevice).toHaveBeenCalledOnce()

    finishRegistration()
    await registration
    expect(useDevicesStore.getState().pendingAutoRegistration).toBe(false)
  })

  it("clears the pending state after failure so manual setup is available", async () => {
    vi.mocked(registerDevice).mockRejectedValueOnce(new Error("Registration failed"))
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

  it("registers when hasLocalAppKeys is true but current device is not registered", async () => {
    useDevicesStore.getState().setPendingAutoRegistration(true)
    useDevicesStore.setState({hasLocalAppKeys: true})
    useUserStore.setState({publicKey: "abc123", privateKey: "def456"})

    await autoRegisterDevice()

    expect(registerDevice).toHaveBeenCalledWith(2000)
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
