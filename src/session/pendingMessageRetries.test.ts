import {describe, expect, it, vi, type MockInstance} from "vitest"
import {
  AppKeys,
  InMemoryStorageAdapter,
  Session,
  SessionManager,
} from "nostr-double-ratchet"
import {finalizeEvent, generateSecretKey, getPublicKey} from "nostr-tools"

const pair = () => {
  const a = generateSecretKey()
  const b = generateSecretKey()
  const shared = generateSecretKey()
  return {
    sender: Session.init(getPublicKey(b), a, true, shared),
    receiver: Session.init(getPublicKey(a), b, false, shared),
  }
}

describe("installed messaging runtime", () => {
  it("bounds decryption work when roster backfill retries pending envelopes", async () => {
    const ownerKey = generateSecretKey()
    const owner = getPublicKey(ownerKey)
    const peerKey = generateSecretKey()
    const peer = getPublicKey(peerKey)
    const inviteKey = generateSecretKey()
    const manager = SessionManager.createForRuntime(
      owner,
      ownerKey,
      owner,
      owner,
      {
        ephemeralKeypair: {privateKey: inviteKey, publicKey: getPublicKey(inviteKey)},
        sharedSecret: "test",
      },
      new InMemoryStorageAdapter()
    )
    const appKeys = new AppKeys([{identityPubkey: peer, createdAt: 1}])
    let receive: MockInstance<Session["receiveEvent"]> | undefined
    try {
      await manager.init()
      await manager.applyTrustedAppKeysSnapshot({
        ownerPubkey: peer,
        appKeys,
        createdAt: 1,
      })
      const device = manager.getUserRecords().get(peer)!.devices.get(peer)!
      device.inactiveSessions = Array.from({length: 8}, () => pair().sender)
      const {sender, receiver} = pair()
      const envelopes = Array.from(
        {length: 8},
        (_, i) => sender.sendEvent({kind: 14, content: `pending ${i}`}).event
      )
      receive = vi.spyOn(Session.prototype, "receiveEvent")
      for (const event of envelopes) expect(manager.feedEvent(event)).toBe(false)
      expect(receive).toHaveBeenCalledTimes(64)

      // These real signed roster events follow the same async retry path seen
      // in the startup CPU profile. They don't change any receive keys.
      for (let i = 0; i < 20; i++) {
        manager.feedEvent(
          finalizeEvent(
            appKeys.getEvent({
              ownerPrivateKey: peerKey,
              ownerPubkey: peer,
              createdAt: i + 2,
            }),
            peerKey
          )
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      expect(receive).toHaveBeenCalledTimes(64)

      device.activeSession = receiver
      expect(manager.feedEvent(envelopes[0])).toBe(true)
    } finally {
      receive?.mockRestore()
      manager.close()
    }
  }, 15000)
})
