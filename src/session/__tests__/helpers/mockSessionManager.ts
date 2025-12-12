import {vi} from "vitest"
import {
  Filter,
  generateSecretKey,
  getPublicKey,
  UnsignedEvent,
  VerifiedEvent,
} from "nostr-tools"
import {InMemoryStorageAdapter, SessionManager} from "nostr-double-ratchet/src"
import {MockRelay} from "./mockRelay"

export const createMockSessionManager = async (
  deviceId: string,
  sharedMockRelay?: MockRelay,
  existingSecretKey?: Uint8Array,
  existingStorage?: InMemoryStorageAdapter
) => {
  const secretKey = existingSecretKey || generateSecretKey()
  const publicKey = getPublicKey(secretKey)

  const mockStorage = existingStorage || new InMemoryStorageAdapter()
  const storageSpy = {
    get: vi.spyOn(mockStorage, "get"),
    del: vi.spyOn(mockStorage, "del"),
    put: vi.spyOn(mockStorage, "put"),
    list: vi.spyOn(mockStorage, "list"),
  }

  const mockRelay = sharedMockRelay || new MockRelay()

  const subscribe = vi
    .fn()
    .mockImplementation((filter: Filter, onEvent: (event: VerifiedEvent) => void) => {
      return mockRelay.subscribe(filter, onEvent)
    })

  const publish = vi.fn().mockImplementation(async (event: UnsignedEvent) => {
    return await mockRelay.publish(event, secretKey)
  })

  const manager = new SessionManager(
    publicKey,
    secretKey,
    deviceId,
    subscribe,
    publish,
    mockStorage
  )

  await manager.init()

  const onEvent = vi.fn()
  manager.onEvent(onEvent)

  return {
    manager,
    subscribe,
    publish,
    onEvent,
    mockStorage,
    storageSpy,
    secretKey,
    publicKey,
    relay: mockRelay,
  }
}
