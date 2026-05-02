import {beforeEach, describe, expect, it} from "vitest"
import localforage from "localforage"
import {generateSecretKey, getPublicKey} from "nostr-tools"
import {
  CHAT_MESSAGE_KIND,
  buildRumorEvent,
  buildTextRumor,
  deserializeSessionState,
  serializeSessionState,
  Session,
  TYPING_KIND,
} from "nostr-double-ratchet"
import {tryDecryptDmPushEvent} from "./dmPushDecrypt"

const createSessionPair = () => {
  const initiatorPriv = generateSecretKey()
  const responderPriv = generateSecretKey()
  const initiatorPub = getPublicKey(initiatorPriv)
  const responderPub = getPublicKey(responderPriv)
  const sharedSecret = generateSecretKey()

  const sender = Session.init(
    responderPub,
    initiatorPriv,
    true,
    sharedSecret
  )

  const receiver = Session.init(
    initiatorPub,
    responderPriv,
    false,
    sharedSecret
  )

  return {sender, receiver}
}

describe("dmPushDecrypt", () => {
  const storage = localforage.createInstance({
    name: "test-iris-session-manager",
    storeName: "session-private",
  })

  beforeEach(async () => {
    await storage.clear()
  })

  it("tries multiple sessions when the first matching one can't decrypt", async () => {
    const {sender, receiver} = createSessionPair()

    const {event: outer} = sender.sendEvent(buildTextRumor("hello"))

    const correctState = serializeSessionState(receiver.state)
    const corrupted = deserializeSessionState(correctState)
    corrupted.rootKey = new Uint8Array(corrupted.rootKey)
    corrupted.rootKey[0] = (corrupted.rootKey[0] ?? 0) ^ 0xff
    const wrongState = serializeSessionState(corrupted)

    const peerOwnerPubkey = "1".repeat(64)

    await storage.setItem(`privatev1/user/${peerOwnerPubkey}`, {
      publicKey: peerOwnerPubkey,
      devices: [
        {
          deviceId: "device-1",
          activeSession: {name: "active-wrong", state: wrongState},
          inactiveSessions: [{name: "inactive-correct", state: correctState}],
          createdAt: Math.floor(Date.now() / 1000),
        },
      ],
    })

    const result = await tryDecryptDmPushEvent(outer, {storage, timeoutMs: 25})

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.kind).toBe(CHAT_MESSAGE_KIND)
    expect(result.content).toBe("hello")
    expect(result.userPublicKey).toBe(peerOwnerPubkey)
  })

  it("marks typing events as silent (no notification)", async () => {
    const {sender, receiver} = createSessionPair()

    const {event: outer} = sender.sendEvent(
      buildRumorEvent({kind: TYPING_KIND, content: ""})
    )

    const state = serializeSessionState(receiver.state)
    const peerOwnerPubkey = "2".repeat(64)

    await storage.setItem(`privatev1/user/${peerOwnerPubkey}`, {
      publicKey: peerOwnerPubkey,
      devices: [
        {
          deviceId: "device-1",
          activeSession: {name: "active", state},
          inactiveSessions: [],
          createdAt: Math.floor(Date.now() / 1000),
        },
      ],
    })

    const result = await tryDecryptDmPushEvent(outer, {storage, timeoutMs: 25})

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.kind).toBe(TYPING_KIND)
    expect(result.silent).toBe(true)
  })
})
