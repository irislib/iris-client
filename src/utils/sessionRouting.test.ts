import {describe, it, expect} from "vitest"
import {
  hasExistingSessionWithRecipient,
  isOwnDeviceEvent,
  resolveSessionPubkeyToOwner,
} from "./sessionRouting"

const OWNER = "a".repeat(64)
const CURRENT_DEVICE = "b".repeat(64)
const OTHER_DEVICE = "c".repeat(64)
const OTHER_USER = "d".repeat(64)

const devices = [{identityPubkey: OTHER_DEVICE, createdAt: Math.floor(Date.now() / 1000)}]

describe("isOwnDeviceEvent", () => {
  it("treats registered devices as own", () => {
    const result = isOwnDeviceEvent(
      OTHER_DEVICE,
      OTHER_DEVICE,
      OWNER,
      CURRENT_DEVICE,
      devices
    )
    expect(result).toBe(true)
  })

  it("treats owner pubkey as own", () => {
    const result = isOwnDeviceEvent(OWNER, OWNER, OWNER, CURRENT_DEVICE, devices)
    expect(result).toBe(true)
  })

  it("treats current device pubkey as own", () => {
    const result = isOwnDeviceEvent(
      CURRENT_DEVICE,
      OTHER_USER,
      OWNER,
      CURRENT_DEVICE,
      devices
    )
    expect(result).toBe(true)
  })

  it("does not treat other users as own", () => {
    const result = isOwnDeviceEvent(
      OTHER_USER,
      OTHER_USER,
      OWNER,
      CURRENT_DEVICE,
      devices
    )
    expect(result).toBe(false)
  })
})

describe("hasExistingSessionWithRecipient", () => {
  it("returns true when an active session already exists for the recipient", () => {
    const userRecords = new Map([
      [
        "peer-pubkey",
        {
          devices: new Map([
            [
              "device-1",
              {
                activeSession: {
                  state: {
                    theirCurrentNostrPublicKey: "peer-pubkey",
                    theirNextNostrPublicKey: "peer-next-pubkey",
                  },
                },
                inactiveSessions: [],
              },
            ],
          ]),
        },
      ],
    ])

    expect(hasExistingSessionWithRecipient(userRecords, "peer-pubkey")).toBe(true)
  })

  it("returns true when the recipient key appears in an inactive session state", () => {
    const userRecords = new Map([
      [
        "legacy-peer-pubkey",
        {
          devices: new Map([
            [
              "device-2",
              {
                activeSession: null,
                inactiveSessions: [
                  {
                    state: {
                      theirCurrentNostrPublicKey: "old-key",
                      theirNextNostrPublicKey: "peer-pubkey",
                    },
                  },
                ],
              },
            ],
          ]),
        },
      ],
    ])

    expect(hasExistingSessionWithRecipient(userRecords, "peer-pubkey")).toBe(true)
  })

  it("returns false when there are no sessions for the recipient", () => {
    const userRecords = new Map([
      [
        "other-peer",
        {
          devices: new Map([
            [
              "device-3",
              {
                activeSession: null,
                inactiveSessions: [],
              },
            ],
          ]),
        },
      ],
    ])

    expect(hasExistingSessionWithRecipient(userRecords, "peer-pubkey")).toBe(false)
  })
})

describe("resolveSessionPubkeyToOwner", () => {
  it("returns the owner when given a known delegate device from app keys", () => {
    const linkedDevice = "e".repeat(64)
    const userRecords = new Map([
      [
        OTHER_USER,
        {
          devices: new Map(),
          appKeys: {
            getAllDevices: () => [{identityPubkey: linkedDevice}],
          },
        },
      ],
    ])

    expect(resolveSessionPubkeyToOwner(userRecords, linkedDevice)).toBe(OTHER_USER)
  })

  it("returns the owner when a session device id matches the pubkey", () => {
    const linkedDevice = "f".repeat(64)
    const userRecords = new Map([
      [
        OTHER_USER,
        {
          devices: new Map([
            [
              linkedDevice,
              {
                activeSession: null,
                inactiveSessions: [],
              },
            ],
          ]),
        },
      ],
    ])

    expect(resolveSessionPubkeyToOwner(userRecords, linkedDevice)).toBe(OTHER_USER)
  })

  it("falls back to the original pubkey when there is no known owner mapping", () => {
    const unknownDevice = "f".repeat(64)
    expect(resolveSessionPubkeyToOwner(new Map(), unknownDevice)).toBe(unknownDevice)
  })
})
