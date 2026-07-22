import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import type {NostrPublish} from "nostr-double-ratchet"

const mocks = vi.hoisted(() => {
  const ownerPubkey = "a".repeat(64)
  const runtimeState = {
    ownerPubkey,
    currentDevicePubkey: "b".repeat(64),
    registeredDevices: [],
    hasLocalAppKeys: false,
    isCurrentDeviceRegistered: false,
    appKeysManagerReady: false,
    sessionManagerReady: false,
    lastAppKeysCreatedAt: undefined,
  }

  return {
    ownerPubkey,
    runtimeState,
    order: [] as string[],
    hydrationPromise: Promise.resolve() as Promise<void>,
    resolveHydration: undefined as (() => void) | undefined,
    runtimeOptions: undefined as {nostrPublish: NostrPublish} | undefined,
    publishFailures: new Set<string>(),
    messageEvents: new Map<string, Map<string, Record<string, unknown>>>(),
    initForOwner: vi.fn<(ownerPubkey: string) => Promise<void>>(),
    close: vi.fn(),
    updateMessage: vi.fn(),
    awaitHydration: vi.fn(),
    connect: vi.fn(),
    connectedRelays: vi.fn(),
    attachSession: vi.fn(),
    cleanupSession: vi.fn(),
    attachGroup: vi.fn(),
    cleanupGroup: vi.fn(),
  }
})

vi.mock("nostr-double-ratchet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nostr-double-ratchet")>()

  class MockNdrRuntime {
    constructor(options: {nostrPublish: NostrPublish}) {
      mocks.runtimeOptions = options
    }

    onStateChange(callback: (state: typeof mocks.runtimeState) => void) {
      callback(mocks.runtimeState)
      return () => {}
    }

    close() {
      mocks.order.push("runtime:close")
      mocks.close()
    }

    getState() {
      return mocks.runtimeState
    }

    getDelegateManager() {
      return null
    }

    getAppKeysManager() {
      return null
    }

    getSessionUserRecords() {
      return new Map()
    }

    async initForOwner(ownerPubkey: string) {
      mocks.order.push("runtime:init")
      await mocks.initForOwner(ownerPubkey)
    }

    async republishInvite() {
      mocks.order.push("runtime:republish")
    }
  }

  return {...actual, NdrRuntime: MockNdrRuntime}
})

vi.mock("../../session/StorageAdapter", () => ({
  LocalForageStorageAdapter: class {},
}))

vi.mock("../../stores/user", () => ({
  useUserStore: {
    getState: () => ({
      publicKey: mocks.ownerPubkey,
      linkedDevice: false,
      privateKey: undefined,
    }),
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
      events: mocks.messageEvents,
      awaitHydration: mocks.awaitHydration,
      updateMessage: mocks.updateMessage,
    }),
  },
}))

vi.mock("@/utils/ndk", () => ({
  ndk: () => ({
    pool: {
      connectedRelays: mocks.connectedRelays,
      connect: mocks.connect,
    },
  }),
}))

vi.mock("@/utils/dmEventHandler", () => ({
  attachNdrRuntimeEventListener: mocks.attachSession,
  cleanupNdrRuntimeEventListener: mocks.cleanupSession,
}))

vi.mock("@/utils/groupMessageHandler", () => ({
  attachGroupMessageListener: mocks.attachGroup,
  cleanupGroupMessageListener: mocks.cleanupGroup,
}))

vi.mock("./runtimeSubscribe", () => ({
  createRuntimeSubscribe: vi.fn(() => vi.fn()),
}))

vi.mock("./deviceLabels", () => ({
  getCurrentDeviceRegistrationLabels: vi.fn(),
  getLinkedDeviceRegistrationLabels: vi.fn(),
}))

vi.mock("@/lib/ndk", () => {
  class MockNDKEvent {
    id: string

    constructor(_ndk: unknown, event: {id?: string}) {
      this.id = event.id || "unsigned-event"
    }

    async publish() {
      mocks.order.push(`publish:${this.id}`)
      if (mocks.publishFailures.has(this.id)) {
        throw new Error("publish failed")
      }
      return new Set()
    }
  }

  return {
    default: class MockNDK {},
    NDKEvent: MockNDKEvent,
  }
})

describe("PrivateChats runtime startup", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    mocks.order.length = 0
    mocks.runtimeOptions = undefined
    mocks.publishFailures.clear()
    mocks.messageEvents.clear()
    mocks.resolveHydration = undefined
    mocks.hydrationPromise = Promise.resolve()

    mocks.initForOwner.mockReset().mockResolvedValue(undefined)
    mocks.close.mockReset()
    mocks.connect.mockReset().mockImplementation(async () => {
      mocks.order.push("relay:connect")
    })
    mocks.connectedRelays.mockReset().mockReturnValue([])
    mocks.attachSession.mockReset().mockImplementation(() => {
      mocks.order.push("session:attach")
    })
    mocks.cleanupSession.mockReset().mockImplementation(() => {
      mocks.order.push("session:cleanup")
    })
    mocks.attachGroup.mockReset().mockImplementation(() => {
      mocks.order.push("group:attach")
    })
    mocks.cleanupGroup.mockReset().mockImplementation(() => {
      mocks.order.push("group:cleanup")
    })
    mocks.awaitHydration.mockReset().mockImplementation(async () => {
      mocks.order.push("messages:hydrate:start")
      await mocks.hydrationPromise
      mocks.order.push("messages:hydrate:end")
    })
    mocks.updateMessage
      .mockReset()
      .mockImplementation(
        async (chatId: string, messageId: string, updates: Record<string, unknown>) => {
          const messageMap = mocks.messageEvents.get(chatId)
          const existing = messageMap?.get(messageId)
          if (existing) messageMap?.set(messageId, {...existing, ...updates})
        }
      )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("hydrates messages and attaches handlers before connecting or backfilling", async () => {
    mocks.hydrationPromise = new Promise<void>((resolve) => {
      mocks.resolveHydration = resolve
    })
    const {initPrivateMessaging} = await import("./PrivateChats")

    const initialization = initPrivateMessaging(mocks.ownerPubkey)
    await Promise.resolve()

    expect(mocks.order).toEqual(["messages:hydrate:start"])

    mocks.resolveHydration?.()
    await initialization

    expect(mocks.order).toEqual([
      "messages:hydrate:start",
      "messages:hydrate:end",
      "session:attach",
      "group:attach",
      "relay:connect",
      "runtime:init",
      "runtime:republish",
    ])
  })

  it("cleans up listeners and the partial runtime when initialization fails", async () => {
    mocks.initForOwner.mockRejectedValueOnce(new Error("init failed"))
    const {initPrivateMessaging} = await import("./PrivateChats")

    await expect(initPrivateMessaging(mocks.ownerPubkey)).rejects.toThrow("init failed")

    expect(mocks.order).toEqual([
      "messages:hydrate:start",
      "messages:hydrate:end",
      "session:attach",
      "group:attach",
      "relay:connect",
      "runtime:init",
      "session:cleanup",
      "group:cleanup",
      "runtime:close",
    ])
  })

  it("uses the callback inner event id and keeps its first successful outer id", async () => {
    const innerEventId = "inner-event"
    const messageMap = new Map([[innerEventId, {id: innerEventId, sentToRelays: false}]])
    mocks.messageEvents.set("chat", messageMap)
    mocks.publishFailures.add("failed-outer")

    const {getNdrRuntime} = await import("./PrivateChats")
    getNdrRuntime()
    const publish = mocks.runtimeOptions?.nostrPublish
    expect(publish).toBeTypeOf("function")

    const event = (id: string) =>
      ({
        id,
        pubkey: "c".repeat(64),
        created_at: 1,
        kind: 1059,
        tags: [["inner", "wrong-event"]],
        content: "ciphertext",
        sig: "d".repeat(128),
      }) as Parameters<NostrPublish>[0]

    await expect(publish!(event("failed-outer"), innerEventId)).rejects.toThrow(
      "publish failed"
    )
    await publish!(event("first-outer"), innerEventId)
    await publish!(event("second-outer"), innerEventId)

    expect(messageMap.get(innerEventId)).toMatchObject({
      sentToRelays: true,
      nostrEventId: "first-outer",
    })
    expect(mocks.updateMessage).toHaveBeenNthCalledWith(1, "chat", innerEventId, {
      sentToRelays: true,
      nostrEventId: "first-outer",
    })
    expect(mocks.updateMessage).toHaveBeenNthCalledWith(2, "chat", innerEventId, {
      sentToRelays: true,
    })
  })
})
