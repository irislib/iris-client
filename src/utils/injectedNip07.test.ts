import {describe, expect, it, vi} from "vitest"

import {
  maybeAutoEnableInjectedNip07Login,
  shouldAutoEnableInjectedNip07Login,
} from "./injectedNip07"

function createState(overrides: Partial<Parameters<typeof shouldAutoEnableInjectedNip07Login>[0]> = {}) {
  return {
    publicKey: "",
    privateKey: "",
    nip07Login: false,
    linkedDevice: false,
    setPublicKey: vi.fn(),
    setNip07Login: vi.fn(),
    setLinkedDevice: vi.fn(),
    ...overrides,
  }
}

describe("shouldAutoEnableInjectedNip07Login", () => {
  it("enables shell NIP-07 only for injected child runtimes with no existing auth", () => {
    expect(
      shouldAutoEnableInjectedNip07Login(createState(), {
        injectedChildRuntime: true,
        hasNostr: true,
      })
    ).toBe(true)

    expect(
      shouldAutoEnableInjectedNip07Login(createState({publicKey: "abc"}), {
        injectedChildRuntime: true,
        hasNostr: true,
      })
    ).toBe(false)

    expect(
      shouldAutoEnableInjectedNip07Login(createState(), {
        injectedChildRuntime: false,
        hasNostr: true,
      })
    ).toBe(false)
  })
})

describe("maybeAutoEnableInjectedNip07Login", () => {
  it("hydrates the store from the injected signer", async () => {
    const state = createState()

    await expect(
      maybeAutoEnableInjectedNip07Login({
        getState: () => state,
        injectedChildRuntime: true,
        getPublicKey: vi.fn().mockResolvedValue("abc123"),
      })
    ).resolves.toBe(true)

    expect(state.setPublicKey).toHaveBeenCalledWith("abc123")
    expect(state.setNip07Login).toHaveBeenCalledWith(true)
    expect(state.setLinkedDevice).toHaveBeenCalledWith(false)
  })

  it("does nothing when auth already exists", async () => {
    const state = createState({nip07Login: true})
    const getPublicKey = vi.fn().mockResolvedValue("abc123")

    await expect(
      maybeAutoEnableInjectedNip07Login({
        getState: () => state,
        injectedChildRuntime: true,
        getPublicKey,
      })
    ).resolves.toBe(false)

    expect(getPublicKey).not.toHaveBeenCalled()
    expect(state.setPublicKey).not.toHaveBeenCalled()
  })
})
