import {describe, expect, it} from "vitest"

import {
  applySessionFallbackHasAppKeys,
  computeTimeoutFallbackHasAppKeys,
  hasExistingSessionWithRecipient,
} from "./useRecipientHasAppKeys"

type SessionStateLike = {
  theirCurrentNostrPublicKey?: string
  theirNextNostrPublicKey?: string
}

type SessionLike = {
  state?: SessionStateLike
}

type DeviceLike = {
  activeSession?: SessionLike | null
  inactiveSessions?: Array<SessionLike | null>
}

type UserRecordLike = {
  devices: Map<string, DeviceLike>
}

const makeRecords = (
  entries: Array<[string, Array<[string, DeviceLike]>]>
): Map<string, UserRecordLike> =>
  new Map(
    entries.map(([userPubkey, devices]) => [userPubkey, {devices: new Map(devices)}])
  )

describe("hasExistingSessionWithRecipient", () => {
  it("returns true when an active session already exists for the recipient", () => {
    const userRecords = makeRecords([
      [
        "peer-pubkey",
        [
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
        ],
      ],
    ])

    expect(hasExistingSessionWithRecipient(userRecords, "peer-pubkey")).toBe(true)
  })

  it("returns true when the recipient key appears in an inactive session state", () => {
    const userRecords = makeRecords([
      [
        "legacy-peer-pubkey",
        [
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
        ],
      ],
    ])

    expect(hasExistingSessionWithRecipient(userRecords, "peer-pubkey")).toBe(true)
  })

  it("returns false when there are no sessions for the recipient", () => {
    const userRecords = makeRecords([
      [
        "other-peer",
        [
          [
            "device-3",
            {
              activeSession: null,
              inactiveSessions: [],
            },
          ],
        ],
      ],
    ])

    expect(hasExistingSessionWithRecipient(userRecords, "peer-pubkey")).toBe(false)
  })
})

describe("computeTimeoutFallbackHasAppKeys", () => {
  it("keeps explicit empty AppKeys as false even when we have a local session", () => {
    expect(computeTimeoutFallbackHasAppKeys(false, true)).toBe(false)
  })

  it("uses local session as fallback when no AppKeys response arrived yet", () => {
    expect(computeTimeoutFallbackHasAppKeys(null, true)).toBe(true)
  })

  it("returns false when no AppKeys response and no local session", () => {
    expect(computeTimeoutFallbackHasAppKeys(null, false)).toBe(false)
  })
})

describe("applySessionFallbackHasAppKeys", () => {
  it("does not override explicit empty AppKeys false", () => {
    expect(applySessionFallbackHasAppKeys(false, true)).toBe(false)
  })

  it("converts unknown state to true when local session exists", () => {
    expect(applySessionFallbackHasAppKeys(null, true)).toBe(true)
  })

  it("keeps unknown state when no local session exists", () => {
    expect(applySessionFallbackHasAppKeys(null, false)).toBe(null)
  })
})
