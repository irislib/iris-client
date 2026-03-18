import {afterEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent, generateSecretKey, getPublicKey, type VerifiedEvent} from "nostr-tools"
import {AppKeys} from "nostr-double-ratchet"
import {waitForLatestAppKeysSnapshot} from "./appKeysSnapshots"

const createSignedAppKeysEvent = (ownerSecretKey: Uint8Array, devicePubkeys: string[], createdAt: number) => {
  const appKeys = new AppKeys(
    devicePubkeys.map((identityPubkey) => ({
      identityPubkey,
      createdAt,
    }))
  )
  const unsignedEvent = appKeys.getEvent()
  unsignedEvent.created_at = createdAt
  return finalizeEvent(unsignedEvent, ownerSecretKey) as VerifiedEvent
}

describe("waitForLatestAppKeysSnapshot", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("keeps listening through the timeout window and returns the newest AppKeys snapshot", async () => {
    vi.useFakeTimers()

    const ownerSecretKey = generateSecretKey()
    const ownerPubkey = getPublicKey(ownerSecretKey)
    const device1 = getPublicKey(generateSecretKey())
    const device2 = getPublicKey(generateSecretKey())
    const unsubscribe = vi.fn()

    const olderEvent = createSignedAppKeysEvent(ownerSecretKey, [device1], 100)
    const newerEvent = createSignedAppKeysEvent(ownerSecretKey, [device1, device2], 101)

    const subscribe = vi.fn((_filter, onEvent) => {
      setTimeout(() => onEvent(olderEvent), 10)
      setTimeout(() => onEvent(newerEvent), 50)
      return unsubscribe
    })

    const snapshotPromise = waitForLatestAppKeysSnapshot(ownerPubkey, subscribe, 100)

    await vi.advanceTimersByTimeAsync(100)

    const snapshot = await snapshotPromise
    expect(snapshot?.createdAt).toBe(101)
    expect(snapshot?.appKeys.getAllDevices().map((device) => device.identityPubkey)).toEqual(
      [device1, device2]
    )
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
