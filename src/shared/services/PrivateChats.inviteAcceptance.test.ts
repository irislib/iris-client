import {beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => {
  const ownerPubkey = "a".repeat(64)
  const devicePubkey = "b".repeat(64)
  const linkInvite = {
    inviter: devicePubkey,
    inviterEphemeralPublicKey: "c".repeat(64),
    inviterEphemeralPrivateKey: new Uint8Array([1, 2, 3]),
    ownerPubkey,
    purpose: "link",
    sharedSecret: "d".repeat(64),
  }

  const runtimeState = {
    ownerPubkey,
    currentDevicePubkey: devicePubkey,
    registeredDevices: [],
    hasLocalAppKeys: false,
    isCurrentDeviceRegistered: false,
    appKeysManagerReady: false,
    sessionManagerReady: false,
    lastAppKeysCreatedAt: undefined,
  }

  const runtime = {
    onStateChange: vi.fn(() => () => {}),
    close: vi.fn(),
    getState: vi.fn(() => runtimeState),
    getDelegateManager: vi.fn(() => null),
    getAppKeysManager: vi.fn(() => null),
    getSessionManager: vi.fn(() => null),
    initDelegateManager: vi.fn().mockResolvedValue(undefined),
    initForOwner: vi.fn().mockResolvedValue({}),
    createLinkInvite: vi.fn().mockImplementation(async (ownerPublicKey?: string) => ({
      ...linkInvite,
      ownerPubkey: ownerPublicKey,
    })),
    acceptInvite: vi.fn().mockResolvedValue({
      ownerPublicKey: ownerPubkey,
      deviceId: devicePubkey,
      session: {},
    }),
    republishInvite: vi.fn().mockResolvedValue(undefined),
  }

  const ndkInstance = {
    pool: {
      connectedRelays: vi.fn(() => [{}]),
      connect: vi.fn().mockResolvedValue(undefined),
    },
    signer: {
      encrypt: vi.fn().mockResolvedValue("ciphertext"),
    },
    getUser: vi.fn(() => ({})),
    subscribe: vi.fn(() => ({
      on: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    })),
  }

  const userState = {
    publicKey: ownerPubkey,
    linkedDevice: false,
    privateKey: undefined as string | undefined,
  }

  return {
    ownerPubkey,
    devicePubkey,
    linkInvite,
    runtime,
    ndkInstance,
    runtimeState,
    userState,
  }
})

vi.mock("nostr-double-ratchet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nostr-double-ratchet")>()

  class MockNdrRuntime {
    constructor(_options: unknown) {}

    onStateChange(callback: (state: typeof mocks.runtimeState) => void) {
      callback(mocks.runtimeState)
      return mocks.runtime.onStateChange(callback)
    }

    close() {
      return mocks.runtime.close()
    }

    getState() {
      return mocks.runtime.getState()
    }

    getDelegateManager() {
      return mocks.runtime.getDelegateManager()
    }

    getAppKeysManager() {
      return mocks.runtime.getAppKeysManager()
    }

    getSessionManager() {
      return mocks.runtime.getSessionManager()
    }

    initDelegateManager() {
      return mocks.runtime.initDelegateManager()
    }

    initForOwner(ownerPubkey: string) {
      return mocks.runtime.initForOwner(ownerPubkey)
    }

    createLinkInvite(ownerPubkey?: string) {
      return mocks.runtime.createLinkInvite(ownerPubkey)
    }

    acceptInvite(invite: unknown, options?: {ownerPublicKey?: string}) {
      return mocks.runtime.acceptInvite(invite, options)
    }

    republishInvite() {
      return mocks.runtime.republishInvite()
    }
  }

  return {
    ...actual,
    NdrRuntime: MockNdrRuntime,
  }
})

vi.mock("../../stores/user", () => ({
  useUserStore: {
    getState: () => mocks.userState,
  },
}))

vi.mock("../../stores/devices", () => ({
  useDevicesStore: {
    getState: () => ({
      setIdentityPubkey: vi.fn(),
      setAppKeysManagerReady: vi.fn(),
      setSessionManagerReady: vi.fn(),
      setHasLocalAppKeys: vi.fn(),
      setRegisteredDevices: vi.fn(),
    }),
  },
}))

vi.mock("@/stores/privateMessages", () => ({
  usePrivateMessagesStore: {
    getState: () => ({
      events: new Map(),
      updateMessage: vi.fn(),
    }),
  },
}))

vi.mock("@/utils/ndk", () => ({
  ndk: () => mocks.ndkInstance,
}))

vi.mock("@/utils/dmEventHandler", () => ({
  attachSessionEventListener: vi.fn(),
}))

vi.mock("@/utils/groupMessageHandler", () => ({
  attachGroupMessageListener: vi.fn(),
}))

vi.mock("@/lib/ndk", () => {
  class MockNDKEvent {
    id = "mock-event-id"
    created_at = Math.floor(Date.now() / 1000)

    constructor(_ndk: unknown, _event: unknown) {}

    async publish() {
      return new Set()
    }
  }

  class MockNDK {}

  return {
    default: MockNDK,
    NDKEvent: MockNDKEvent,
    NDKSubscriptionCacheUsage: {
      PARALLEL: "PARALLEL",
      ONLY_RELAY: "ONLY_RELAY",
    },
  }
})

describe("PrivateChats invite acceptance", () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.runtime.onStateChange.mockClear()
    mocks.runtime.close.mockClear()
    mocks.runtime.getState.mockClear()
    mocks.runtime.getDelegateManager.mockClear()
    mocks.runtime.getAppKeysManager.mockClear()
    mocks.runtime.getSessionManager.mockClear()
    mocks.runtime.initDelegateManager.mockClear()
    mocks.runtime.initForOwner.mockClear()
    mocks.runtime.createLinkInvite.mockClear()
    mocks.runtime.acceptInvite.mockClear()
    mocks.runtime.republishInvite.mockClear()
    mocks.ndkInstance.pool.connectedRelays.mockClear()
    mocks.ndkInstance.pool.connect.mockClear()
    mocks.userState.publicKey = mocks.ownerPubkey
    mocks.userState.linkedDevice = false
    mocks.userState.privateKey = undefined
  })

  it("createLinkInvite delegates to NdrRuntime with the current owner pubkey", async () => {
    const {createLinkInvite} = await import("./PrivateChats")

    const invite = await createLinkInvite()

    expect(mocks.runtime.initDelegateManager).toHaveBeenCalledTimes(1)
    expect(mocks.runtime.createLinkInvite).toHaveBeenCalledTimes(1)
    expect(mocks.runtime.createLinkInvite).toHaveBeenCalledWith(mocks.ownerPubkey)
    expect(invite).toMatchObject({
      inviter: mocks.devicePubkey,
      ownerPubkey: mocks.ownerPubkey,
      purpose: "link",
    })
  })

  it("acceptLinkInvite delegates to NdrRuntime.acceptInvite with the current owner pubkey", async () => {
    const {acceptLinkInvite} = await import("./PrivateChats")

    const invite = {
      inviter: mocks.devicePubkey,
      ownerPubkey: undefined,
      accept: vi.fn().mockResolvedValue({
        event: {
          kind: 1059,
          tags: [],
          content: "",
          created_at: Math.floor(Date.now() / 1000),
        },
      }),
    } as unknown as import("nostr-double-ratchet").Invite

    await acceptLinkInvite(invite)

    expect(mocks.runtime.initForOwner).toHaveBeenCalledTimes(1)
    expect(mocks.runtime.initForOwner).toHaveBeenCalledWith(mocks.ownerPubkey)
    expect(mocks.runtime.acceptInvite).toHaveBeenCalledTimes(1)
    expect(mocks.runtime.acceptInvite).toHaveBeenCalledWith(invite, {
      ownerPublicKey: mocks.ownerPubkey,
    })
    expect(invite.accept).not.toHaveBeenCalled()
  })
})
