import {beforeEach, expect, it, vi} from "vitest"
import {
  createPrivateContactSync,
  editPrivateContact,
  privateContactDocuments,
} from "nostr-social-graph/privateContactSync"
const owner = "a".repeat(64),
  contact = "b".repeat(64),
  sender = "c".repeat(64),
  local = "d".repeat(64)
const spies = vi.hoisted(() => ({
  merge: vi.fn(async () => {}),
  send: vi.fn(async () => {}),
}))
vi.mock("@/stores/user", () => ({
  useUserStore: {getState: () => ({publicKey: "a".repeat(64)})},
}))
vi.mock("@/stores/devices", () => ({
  useDevicesStore: {
    getState: () => ({
      identityPubkey: "d".repeat(64),
      isCurrentDeviceRegistered: true,
      registeredDevices: [{identityPubkey: "c".repeat(64)}],
    }),
  },
}))
vi.mock("@/shared/services/PrivateChats", () => ({
  getNdrRuntime: () => ({sendEvent: spies.send}),
}))
vi.mock("./privateContactSync", () => ({
  getPrivateContactDocuments: () => [],
  mergePrivateContacts: spies.merge,
}))
import {
  receivePrivateContactControl,
  PRIVATE_CONTACT_CONTROL_KIND,
} from "./privateContactControl"
const document = privateContactDocuments(
  editPrivateContact(
    createPrivateContactSync(owner, "1".repeat(32)),
    contact,
    {nickname: "Private"},
    "2".repeat(32)
  )
)[0]
const rumor = (payload: unknown) => ({
  id: "f".repeat(64),
  pubkey: owner,
  kind: PRIVATE_CONTACT_CONTROL_KIND,
  tags: [["p", owner]],
  created_at: 100,
  content: JSON.stringify(payload),
})
const meta = {senderOwnerPubkey: owner, senderDevicePubkey: sender}
beforeEach(() => vi.clearAllMocks())
it("admits only authenticated sibling documents and preserves exact register stamps", async () => {
  const message = rumor({type: "private-contact-sync", v: 1, document})
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
it("rejects mixed request/document forms and wrong-owner documents before mutation", async () => {
  await receivePrivateContactControl(
    rumor({type: "private-contact-sync", v: 1, request: true, document}),
    meta
  )
  await receivePrivateContactControl(
    rumor({type: "private-contact-sync", v: 1, document: {...document, owner: contact}}),
    meta
  )
  expect(spies.merge).not.toHaveBeenCalled()
  expect(spies.send).not.toHaveBeenCalled()
})
