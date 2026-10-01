import type {Rumor} from "nostr-double-ratchet"
import {beforeEach, expect, it, vi} from "vitest"
import {
  createPrivateContactSync,
  editPrivateContact,
  privateContactDocuments,
} from "nostr-social-graph/privateContactSyncV2"
const owner = "a".repeat(64),
  contact = "b".repeat(64),
  sender = "c".repeat(64),
  local = "d".repeat(64)
const spies = vi.hoisted(() => ({
  owner: "a".repeat(64),
  merge: vi.fn(async () => {}),
  snapshot: vi.fn(async () => {}),
  labels: vi.fn(async () => {}),
  send: vi.fn(async (_owner: string, event: Rumor): Promise<Rumor | undefined> => event),
  state: {
    identityPubkey: "d".repeat(64),
    isCurrentDeviceRegistered: true,
    sessionManagerReady: true,
    appKeysManagerReady: true,
    hasLocalAppKeys: true,
    lastEventTimestamp: 1,
    canSendPrivateMessages: true,
    privateMessagingBlocked: false,
    registeredDevices: [{identityPubkey: "c".repeat(64)}],
  },
}))
vi.mock("@/stores/user", () => ({
  useUserStore: {getState: () => ({publicKey: spies.owner})},
}))
vi.mock("@/stores/devices", () => ({useDevicesStore: {getState: () => spies.state}}))
vi.mock("@/shared/services/PrivateChats", () => ({
  getNdrRuntime: () => ({sendEvent: spies.send}),
}))
vi.mock("./privateContactSync", () => ({
  queuePrivateContacts: spies.snapshot,
  mergePrivateContacts: spies.merge,
}))
vi.mock("./privateDeviceLabels", () => ({sendPrivateDeviceLabels: spies.labels}))
import {
  receivePrivateContactControl,
  sendPrivateContactDocument,
  PRIVATE_CONTACT_CONTROL_KIND,
} from "./privateContactControl"
const document = privateContactDocuments(
  editPrivateContact(createPrivateContactSync(owner, "1".repeat(32)), contact, {
    nickname: "Private",
    favorite: false,
  })
)[0]
const rumor = (payload: unknown, kind = PRIVATE_CONTACT_CONTROL_KIND) => ({
  id: "f".repeat(64),
  pubkey: owner,
  kind,
  tags: [["p", owner]],
  created_at: 100,
  content: JSON.stringify(payload),
})
const meta = {senderOwnerPubkey: owner, senderDevicePubkey: sender}
beforeEach(() => {
  vi.clearAllMocks()
  spies.owner = owner
  spies.state.isCurrentDeviceRegistered = true
})
it("admits only authenticated sibling V2 documents without echoing or changing registers", async () => {
  const message = rumor({type: "private-contact-sync", v: 2, document})
  await receivePrivateContactControl(message, {...meta, senderOwnerPubkey: contact})
  await receivePrivateContactControl(message, {...meta, senderDevicePubkey: local})
  await receivePrivateContactControl(message, {
    ...meta,
    senderDevicePubkey: "e".repeat(64),
  })
  await receivePrivateContactControl(message)
  expect(spies.merge).not.toHaveBeenCalled()
  await receivePrivateContactControl(message, meta)
  expect(spies.merge).toHaveBeenCalledExactlyOnceWith(owner, [document])
  expect(spies.send).not.toHaveBeenCalled()
})
it("rejects legacy controls, mixed variants, and wrong-account documents", async () => {
  await receivePrivateContactControl(
    rumor({type: "private-contact-sync", v: 1, document}, 10451),
    meta
  )
  await receivePrivateContactControl(
    rumor({type: "private-contact-sync", v: 2, request: true, document}),
    meta
  )
  await receivePrivateContactControl(
    rumor({type: "private-contact-sync-request", v: 2, owner, document}),
    meta
  )
  await receivePrivateContactControl(
    rumor({type: "private-contact-sync", v: 2, document: {...document, owner: contact}}),
    meta
  )
  expect(spies.merge).not.toHaveBeenCalled()
  expect(spies.snapshot).not.toHaveBeenCalled()
})
it("propagates durable receive failures so the runtime journal can replay", async () => {
  spies.merge.mockRejectedValueOnce(new Error("disk full"))
  await expect(
    receivePrivateContactControl(
      rumor({type: "private-contact-sync", v: 2, document}),
      meta
    )
  ).rejects.toThrow("disk full")
  await receivePrivateContactControl(
    rumor({type: "private-contact-sync", v: 2, document}),
    meta
  )
  expect(spies.merge).toHaveBeenCalledTimes(2)
})
it("queues only V2 inner controls and acknowledges only the matching durable runtime handoff", async () => {
  expect(await sendPrivateContactDocument(owner, document)).toBe(true)
  expect(spies.send).toHaveBeenCalledWith(owner, expect.objectContaining({kind: 10452}))
  expect(JSON.parse(spies.send.mock.calls[0][1].content)).toEqual({
    type: "private-contact-sync",
    v: 2,
    document,
  })
  spies.send.mockResolvedValueOnce(undefined)
  expect(await sendPrivateContactDocument(owner, document)).toBe(false)
  spies.owner = contact
  expect(await sendPrivateContactDocument(owner, document)).toBe(false)
  expect(spies.send).toHaveBeenCalledTimes(2)
})

it("defers valid journal rows while the account roster is still initializing", async () => {
  spies.state.sessionManagerReady = false
  await expect(
    receivePrivateContactControl(
      rumor({type: "private-contact-sync", v: 2, document}),
      meta
    )
  ).rejects.toThrow("not ready")
  expect(spies.merge).not.toHaveBeenCalled()
  spies.state.sessionManagerReady = true
  await receivePrivateContactControl(
    rumor({type: "private-contact-sync", v: 2, document}),
    meta
  )
  expect(spies.merge).toHaveBeenCalledTimes(1)
})
