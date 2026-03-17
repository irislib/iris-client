/** @vitest-environment jsdom */

import React, {act} from "react"
import {createRoot, Root} from "react-dom/client"
import {generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import SignIn from "./SignIn"
import SignUp from "./SignUp"

const mocks = vi.hoisted(() => ({
  userStore: {
    setNip07Login: vi.fn(),
    setPublicKey: vi.fn(),
    setPrivateKey: vi.fn(),
    setLinkedDevice: vi.fn(),
  },
  userSetState: vi.fn(),
  devicesStore: {
    setPendingAutoRegistration: vi.fn(),
  },
  uiStore: {
    setShowLoginDialog: vi.fn(),
  },
  ndkInstance: {} as {signer?: unknown},
}))

vi.mock("@/stores/user", () => {
  const useUserStore = () => mocks.userStore
  Object.assign(useUserStore, {
    setState: mocks.userSetState,
  })
  return {useUserStore}
})

vi.mock("@/stores/devices", () => {
  const useDevicesStore = () => mocks.devicesStore
  Object.assign(useDevicesStore, {
    getState: () => mocks.devicesStore,
  })
  return {useDevicesStore}
})

vi.mock("@/stores/ui", () => ({
  useUIStore: (
    selector?:
      | ((state: {
          setShowLoginDialog: typeof mocks.uiStore.setShowLoginDialog
        }) => unknown)
      | undefined
  ) => {
    const state = {setShowLoginDialog: mocks.uiStore.setShowLoginDialog}
    return typeof selector === "function" ? selector(state) : state
  },
}))

vi.mock("@/utils/ndk", () => ({
  ndk: () => mocks.ndkInstance,
}))

vi.mock("@/lib/ndk", () => ({
  NDKPrivateKeySigner: class {
    constructor(public readonly privateKey: string) {}
  },
  NDKEvent: class {
    kind = 0
    content = ""
    publish = vi.fn()
  },
}))

vi.mock("@/shared/components/Icons/Icon", () => ({
  default: () => React.createElement("span"),
}))

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new Event("input", {bubbles: true}))
  input.dispatchEvent(new Event("change", {bubbles: true}))
}

describe("imported identity registration", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}
    ).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    vi.clearAllMocks()
    mocks.ndkInstance.signer = undefined
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it("does not mark imported nsec sign-in for auto-registration", async () => {
    const secretKey = generateSecretKey()
    const nsec = nip19.nsecEncode(secretKey)
    const publicKey = getPublicKey(secretKey)
    const onClose = vi.fn()

    await act(async () => {
      root.render(React.createElement(SignIn, {onClose}))
    })

    const input = container.querySelector("input")
    expect(input).toBeTruthy()

    await act(async () => {
      setInputValue(input as HTMLInputElement, nsec)
    })

    expect(mocks.devicesStore.setPendingAutoRegistration).not.toHaveBeenCalled()
    expect(mocks.userStore.setPrivateKey).toHaveBeenCalled()
    expect(mocks.userStore.setPublicKey).toHaveBeenCalledWith(publicKey)
    expect(onClose).toHaveBeenCalled()
  })

  it("does not mark imported nsec sign-up paste for auto-registration", async () => {
    const secretKey = generateSecretKey()
    const nsec = nip19.nsecEncode(secretKey)
    const publicKey = getPublicKey(secretKey)
    const onClose = vi.fn()

    await act(async () => {
      root.render(React.createElement(SignUp, {onClose}))
    })

    const input = container.querySelector("input")
    expect(input).toBeTruthy()

    await act(async () => {
      setInputValue(input as HTMLInputElement, nsec)
    })

    expect(mocks.devicesStore.setPendingAutoRegistration).not.toHaveBeenCalled()
    expect(mocks.userSetState).toHaveBeenCalledWith({
      privateKey: expect.any(String),
      publicKey,
      linkedDevice: false,
    })
    expect(onClose).toHaveBeenCalled()
  })
})
