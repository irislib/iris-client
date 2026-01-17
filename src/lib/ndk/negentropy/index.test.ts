import {describe, expect, it, vi, beforeEach} from "vitest"
import {
  buildStorageVector,
  Negentropy,
  NegentropyStorageVector,
  negentropySync,
} from "./index.js"
import {NDKEvent} from "../events/index.js"
import type {NDKRelay} from "../relay/index.js"

describe("NegentropyStorageVector", () => {
  it("should create empty storage", () => {
    const storage = new NegentropyStorageVector()
    expect(storage.items).toEqual([])
    expect(storage.sealed).toBe(false)
  })

  it("should insert events and seal", () => {
    const storage = new NegentropyStorageVector()
    storage.insert(1000, "0".repeat(64))
    storage.insert(2000, "1".repeat(64))
    storage.seal()

    expect(storage.sealed).toBe(true)
    expect(storage.size()).toBe(2)
  })

  it("should sort items by timestamp", () => {
    const storage = new NegentropyStorageVector()
    storage.insert(2000, "1".repeat(64))
    storage.insert(1000, "0".repeat(64))
    storage.seal()

    const first = storage.getItem(0)
    const second = storage.getItem(1)

    expect(first.timestamp).toBe(1000)
    expect(second.timestamp).toBe(2000)
  })

  it("should reject duplicates", () => {
    const storage = new NegentropyStorageVector()
    const id = "a".repeat(64)
    storage.insert(1000, id)
    storage.insert(1000, id)

    expect(() => storage.seal()).toThrow("duplicate item inserted")
  })

  it("should throw when inserting after seal", () => {
    const storage = new NegentropyStorageVector()
    storage.insert(1000, "0".repeat(64))
    storage.seal()

    expect(() => storage.insert(2000, "1".repeat(64))).toThrow("already sealed")
  })
})

describe("Negentropy", () => {
  it("should initiate sync", () => {
    const storage = new NegentropyStorageVector()
    storage.insert(1000, "0".repeat(64))
    storage.seal()

    const ne = new Negentropy(storage)
    const msg = ne.initiate<string>()

    expect(msg).toBeTruthy()
    expect(typeof msg).toBe("string")
    expect(msg.startsWith("61")).toBe(true) // Protocol version
  })

  it("should detect differences between storages", () => {
    const storage1 = new NegentropyStorageVector()
    storage1.insert(1000, "a".repeat(64))
    storage1.insert(2000, "b".repeat(64))
    storage1.seal()

    const storage2 = new NegentropyStorageVector()
    storage2.insert(1000, "a".repeat(64))
    storage2.insert(3000, "c".repeat(64))
    storage2.seal()

    const ne1 = new Negentropy(storage1)
    const ne2 = new Negentropy(storage2)

    // Initiate from storage1 (client)
    const msg1 = ne1.initiate<string>()
    // Reconcile on storage2 (server responds)
    const [msg2, have2, need2] = ne2.reconcile<string>(msg1)

    // At this point, storage2 (server) should send back response
    // Then storage1 (client) processes it
    const [_finalMsg, have1, need1] = ne1.reconcile<string>(msg2!)

    // Client (storage1) should have events server needs and need events from server
    expect(have1.length + need1.length).toBeGreaterThan(0)
  })

  it("should complete when storages are identical", () => {
    const storage1 = new NegentropyStorageVector()
    storage1.insert(1000, "a".repeat(64))
    storage1.seal()

    const storage2 = new NegentropyStorageVector()
    storage2.insert(1000, "a".repeat(64))
    storage2.seal()

    const ne1 = new Negentropy(storage1)
    const ne2 = new Negentropy(storage2)

    const msg1 = ne1.initiate<string>()
    const [msg2, have2, need2] = ne2.reconcile<string>(msg1)

    expect(have2).toEqual([])
    expect(need2).toEqual([])
  })
})

describe("buildStorageVector", () => {
  it("should build storage from NDKEvents", () => {
    const events = [
      {id: "a".repeat(64), created_at: 1000} as NDKEvent,
      {id: "b".repeat(64), created_at: 2000} as NDKEvent,
    ]

    const storage = buildStorageVector(events)

    expect(storage.sealed).toBe(true)
    expect(storage.size()).toBe(2)
  })

  it("should skip events without id or timestamp", () => {
    const events = [
      {id: "a".repeat(64), created_at: 1000} as NDKEvent,
      {id: undefined, created_at: 2000} as NDKEvent,
      {id: "c".repeat(64), created_at: undefined} as NDKEvent,
    ]

    const storage = buildStorageVector(events)

    expect(storage.size()).toBe(1)
  })
})

describe("negentropySync", () => {
  let mockRelay: Partial<NDKRelay>
  let sendSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sendSpy = vi.fn()
    mockRelay = {
      url: "wss://test.relay",
      connected: true,
      connectivity: {
        send: sendSpy,
      } as any,
      registerProtocolHandler: vi.fn(),
      unregisterProtocolHandler: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }
  })

  it("should send NEG-OPEN message", async () => {
    const storage = new NegentropyStorageVector()
    storage.seal()

    const reconcile = vi.fn(async () => {})
    const filter = {kinds: [1]}

    // Don't await - we'll clean up via abort
    const controller = new AbortController()
    const syncPromise = negentropySync(
      storage,
      mockRelay as NDKRelay,
      filter,
      reconcile,
      {signal: controller.signal}
    )

    // Wait a bit for setup
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Verify NEG-OPEN was sent
    expect(sendSpy).toHaveBeenCalled()
    const lastCall = sendSpy.mock.calls[sendSpy.mock.calls.length - 1][0]
    const msg = JSON.parse(lastCall)
    expect(msg[0]).toBe("NEG-OPEN")
    expect(msg[2]).toEqual(filter)

    // Clean up
    controller.abort()
    await syncPromise
  })

  it("should handle abort signal", async () => {
    const storage = new NegentropyStorageVector()
    storage.seal()

    const reconcile = vi.fn(async () => {})
    const controller = new AbortController()

    // Abort immediately
    controller.abort()

    const result = await negentropySync(
      storage,
      mockRelay as NDKRelay,
      {kinds: [1]},
      reconcile,
      {signal: controller.signal}
    )

    expect(result).toBe(false)
  })

  it("should register and cleanup protocol handlers", async () => {
    const storage = new NegentropyStorageVector()
    storage.seal()

    const reconcile = vi.fn(async () => {})
    const controller = new AbortController()

    const syncPromise = negentropySync(
      storage,
      mockRelay as NDKRelay,
      {kinds: [1]},
      reconcile,
      {signal: controller.signal}
    )

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(mockRelay.registerProtocolHandler).toHaveBeenCalledWith(
      "NEG-MSG",
      expect.any(Function)
    )
    expect(mockRelay.registerProtocolHandler).toHaveBeenCalledWith(
      "NEG-ERR",
      expect.any(Function)
    )

    controller.abort()
    await syncPromise

    expect(mockRelay.unregisterProtocolHandler).toHaveBeenCalledWith("NEG-MSG")
    expect(mockRelay.unregisterProtocolHandler).toHaveBeenCalledWith("NEG-ERR")
  })
})
