import {beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => {
  const ownerPubkey = "a".repeat(64)
  const devicePubkey = "b".repeat(64)

  const sessionManager = {
    init: vi.fn().mockResolvedValue(undefined),
    acceptInvite: vi.fn().mockResolvedValue({
      ownerPublicKey: ownerPubkey,
      deviceId: devicePubkey,
      session: {},
    }),
  }

  const delegateManager = {
    init: vi.fn().mockResolvedValue(undefined),
    activate: vi.fn().mockResolvedValue(undefined),
    createSessionManager: vi.fn(() => sessionManager),
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
  }

  return {
    ownerPubkey,
    devicePubkey,
    sessionManager,
    delegateManager,
    ndkInstance,
    userState,
  }
})

vi.mock("nostr-double-ratchet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nostr-double-ratchet")>()

  class MockDelegateManager {
    async init() {
      return mocks.delegateManager.init()
    }

    async activate(ownerPubkey: string) {
      return mocks.delegateManager.activate(ownerPubkey)
    }

    createSessionManager() {
      return mocks.delegateManager.createSessionManager()
    }
  }

  return {
    ...actual,
    DelegateManager: MockDelegateManager,
  }
})

vi.mock("../../stores/user", () => ({
  useUserStore: {
    getState: () => mocks.userState,
  },
}))

vi.mock("@/utils/ndk", () => ({
  ndk: () => mocks.ndkInstance,
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
  }
})

describe("PrivateChats invite acceptance", () => {
  beforeEach(() => {
    mocks.delegateManager.init.mockClear()
    mocks.delegateManager.activate.mockClear()
    mocks.delegateManager.createSessionManager.mockClear()
    mocks.sessionManager.init.mockClear()
    mocks.sessionManager.acceptInvite.mockClear()
    mocks.ndkInstance.pool.connectedRelays.mockClear()
    mocks.ndkInstance.pool.connect.mockClear()
    mocks.userState.publicKey = mocks.ownerPubkey
    mocks.userState.linkedDevice = false
  })

  it("acceptLinkInvite uses SessionManager.acceptInvite with current owner pubkey", async () => {
    const {initPrivateMessaging, acceptLinkInvite} = await import("./PrivateChats")

    await initPrivateMessaging(mocks.ownerPubkey)

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

    expect(mocks.sessionManager.acceptInvite).toHaveBeenCalledTimes(1)
    expect(mocks.sessionManager.acceptInvite).toHaveBeenCalledWith(invite, {
      ownerPublicKey: mocks.ownerPubkey,
    })
    expect(invite.accept).not.toHaveBeenCalled()
  })
})
