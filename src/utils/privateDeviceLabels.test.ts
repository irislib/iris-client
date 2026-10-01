import {beforeEach, expect, it, vi} from "vitest"
import {AppKeys, type Rumor} from "nostr-double-ratchet"
import {getEventHash} from "nostr-tools"
const owner = "a".repeat(64),
  local = "b".repeat(64),
  sibling = "c".repeat(64)
const spies = vi.hoisted(() => ({
  snapshot: undefined as
    {ownerPubkey: string; createdAt: number; appKeys: AppKeys} | undefined,
  apply: vi.fn(
    async (_snapshot: {ownerPubkey: string; createdAt: number; appKeys: AppKeys}) => {}
  ),
  send: vi.fn(async (_owner: string, event: Rumor): Promise<Rumor | undefined> => event),
  state: {
    identityPubkey: "b".repeat(64),
    isCurrentDeviceRegistered: true,
    sessionManagerReady: true,
    appKeysManagerReady: true,
    hasLocalAppKeys: true,
    lastEventTimestamp: 1,
    registeredDevices: [
      {identityPubkey: "b".repeat(64)},
      {identityPubkey: "c".repeat(64)},
    ],
  },
}))
vi.mock("@/stores/user", () => ({
  useUserStore: {getState: () => ({publicKey: "a".repeat(64)})},
}))
vi.mock("@/stores/devices", () => ({useDevicesStore: {getState: () => spies.state}}))
vi.mock("@/shared/services/PrivateChats", () => ({
  getNdrRuntime: () => ({
    getKnownAppKeysSnapshots: () => (spies.snapshot ? [spies.snapshot] : []),
    applyTrustedAppKeysSnapshot: spies.apply,
    sendEvent: spies.send,
  }),
}))
import {
  getPrivateDeviceLabels,
  receivePrivateDeviceLabel,
  sendPrivateDeviceLabels,
} from "./privateDeviceLabels"
const event = (name: string | null, updatedAtSecs: number): Rumor => {
  const value = {
    pubkey: owner,
    kind: 10453,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["p", owner]],
    content: JSON.stringify({
      type: "device-labels",
      v: 2,
      owner,
      device: local,
      deviceLabel: name,
      clientLabel: null,
      updatedAtSecs,
    }),
  }
  return {...value, id: getEventHash(value)}
}
const meta = {senderOwnerPubkey: owner, senderDevicePubkey: sibling}
beforeEach(() => {
  vi.clearAllMocks()
  spies.snapshot = {
    ownerPubkey: owner,
    createdAt: 5,
    appKeys: new AppKeys([
      {identityPubkey: local, createdAt: 1},
      {identityPubkey: sibling, createdAt: 1},
    ]),
  }
  spies.apply.mockImplementation(async (next) => {
    spies.snapshot = next
  })
})
it("persists authenticated private names and clear tombstones without publishing a public roster", async () => {
  await receivePrivateDeviceLabel(event("Home", 10), meta)
  await receivePrivateDeviceLabel(event(null, 11), meta)
  await receivePrivateDeviceLabel(event("Old", 10), meta)
  expect(getPrivateDeviceLabels(owner)).toEqual([
    expect.objectContaining({device: local, deviceLabel: null, updatedAtSecs: 11}),
  ])
  expect(spies.send).not.toHaveBeenCalled()
  await sendPrivateDeviceLabels(owner)
  expect(spies.send).toHaveBeenCalledExactlyOnceWith(
    owner,
    expect.objectContaining({kind: 10453})
  )
  expect(JSON.parse(spies.send.mock.calls[0][1].content).deviceLabel).toBeNull()
})
it("rejects unknown devices and propagates failed durable storage for journal replay", async () => {
  await receivePrivateDeviceLabel(event("Private", 10), {
    ...meta,
    senderDevicePubkey: "d".repeat(64),
  })
  expect(spies.apply).not.toHaveBeenCalled()
  spies.apply.mockRejectedValueOnce(new Error("disk full"))
  await expect(receivePrivateDeviceLabel(event("Private", 10), meta)).rejects.toThrow(
    "disk full"
  )
  expect(getPrivateDeviceLabels(owner)).toEqual([])
  await receivePrivateDeviceLabel(event("Private", 10), meta)
  expect(getPrivateDeviceLabels(owner)[0].deviceLabel).toBe("Private")
})
it("chooses the same timestamp winner in either order, including Unicode", async () => {
  await receivePrivateDeviceLabel(event("\ufffd", 10), meta)
  await receivePrivateDeviceLabel(event("💚", 10), meta)
  expect(getPrivateDeviceLabels(owner)[0].deviceLabel).toBe("💚")
  await receivePrivateDeviceLabel(event("\ufffd", 10), meta)
  expect(getPrivateDeviceLabels(owner)[0].deviceLabel).toBe("💚")
})
