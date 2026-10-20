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
  Group,
  createGroupData,
  InMemoryStorageAdapter,
  PRIVATE_GROUP_DELIVERY_KIND,
  type Rumor,
} from "nostr-double-ratchet"
import {tryDecryptDmPushEvent} from "./dmPushDecrypt"

const createSessionPair = () => {
  const initiatorPriv = generateSecretKey()
  const responderPriv = generateSecretKey()
  const initiatorPub = getPublicKey(initiatorPriv)
  const responderPub = getPublicKey(responderPriv)
  const sharedSecret = generateSecretKey()

  const sender = Session.init(responderPub, initiatorPriv, true, sharedSecret)

  const receiver = Session.init(initiatorPub, responderPriv, false, sharedSecret)

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

  it("previews private group delivery without consuming live keys and suppresses the wrong sender", async () => {
    const alice = getPublicKey(generateSecretKey())
    const bob = getPublicKey(generateSecretKey())
    const mallory = getPublicKey(generateSecretKey())
    const aliceDevice = getPublicKey(generateSecretKey())
    const bobDevice = getPublicKey(generateSecretKey())
    const group = createGroupData("Private group", alice, [bob, mallory])
    const saved = new InMemoryStorageAdapter()
    const recipient = new Group({
      data: group,
      ourOwnerPubkey: bob,
      ourDevicePubkey: bobDevice,
      storage: saved,
    })
    const author = new Group({
      data: group,
      ourOwnerPubkey: alice,
      ourDevicePubkey: aliceDevice,
      storage: new InMemoryStorageAdapter(),
    })
    let delivery!: Rumor
    await author.sendMessage("Only group members see this", {
      publishOuter: async () => {
        throw new Error("Shared group traffic must stay inside ratchets")
      },
      sendPairwise: async (owner, rumor) => {
        if (owner !== bob) return
        if (rumor.kind === PRIVATE_GROUP_DELIVERY_KIND) delivery = rumor
        else await recipient.handleIncomingSessionEvent(rumor, alice, aliceDevice)
      },
    })
    expect(delivery).toBeDefined()
    for (const key of await saved.list()) {
      await storage.setItem("private" + key, await saved.get(key))
    }
    await storage.setItem("privatev1/device-manager/owner-pubkey", bob)
    await storage.setItem("privatev1/device-manager/identity-public-key", bobDevice)
    await storage.setItem(
      "groups",
      JSON.stringify({state: {groups: {[group.id]: group}}})
    )
    const {sender, receiver} = createSessionPair()
    const record = {
      publicKey: alice,
      devices: [
        {
          deviceId: aliceDevice,
          activeSession: {name: "active", state: serializeSessionState(receiver.state)},
          inactiveSessions: [],
        },
      ],
    }
    await storage.setItem(`privatev1/user/${alice}`, record)
    const outer = sender.sendEvent(delivery).event
    const before = await Promise.all(
      (await storage.keys()).map(async (key) => [key, await storage.getItem(key)])
    )
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await tryDecryptDmPushEvent(outer, {storage, groupStorage: storage})
      expect(result).toMatchObject({
        success: true,
        silent: false,
        groupId: group.id,
        groupName: group.name,
        content: "Only group members see this",
      })
    }
    expect(
      await Promise.all(
        (await storage.keys()).map(async (key) => [key, await storage.getItem(key)])
      )
    ).toEqual(before)
    await storage.removeItem(`privatev1/user/${alice}`)
    await storage.setItem(`privatev1/user/${mallory}`, {...record, publicKey: mallory})
    expect(
      await tryDecryptDmPushEvent(outer, {storage, groupStorage: storage})
    ).toMatchObject({
      success: true,
      silent: true,
      content: "",
    })
  })

  it("never displays a malformed private group control as message text", async () => {
    const {sender, receiver} = createSessionPair()
    const peer = "3".repeat(64)
    await storage.setItem(`privatev1/user/${peer}`, {
      publicKey: peer,
      devices: [
        {
          deviceId: "device",
          activeSession: {name: "active", state: serializeSessionState(receiver.state)},
          inactiveSessions: [],
        },
      ],
    })
    const outer = sender.sendEvent(
      buildRumorEvent({
        kind: PRIVATE_GROUP_DELIVERY_KIND,
        content: '{"type":"group-wake","event":"invalid"}',
      })
    ).event
    expect(await tryDecryptDmPushEvent(outer, {storage})).toMatchObject({
      success: true,
      silent: true,
      content: "",
    })
  })
})
