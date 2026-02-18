import {describe, expect, it} from "vitest"
import {extractSessionPubkeysFromUserRecords} from "./notifications"

const OUR_PUBKEY = "a".repeat(64)
const PEER_ONE = "b".repeat(64)
const PEER_TWO = "c".repeat(64)

function createUserRecordsWithSelfSessions() {
  return new Map([
    [
      PEER_ONE,
      {
        devices: new Map([
          [
            "device-1",
            {
              activeSession: {
                state: {
                  theirCurrentNostrPublicKey: OUR_PUBKEY,
                  theirNextNostrPublicKey: PEER_ONE,
                },
              },
              inactiveSessions: [
                {
                  state: {
                    theirCurrentNostrPublicKey: OUR_PUBKEY,
                    theirNextNostrPublicKey: PEER_TWO,
                  },
                },
              ],
            },
          ],
        ]),
      },
    ],
  ]) as any
}

describe("extractSessionPubkeysFromUserRecords", () => {
  it("excludes our own pubkey from extracted session authors", () => {
    const result = extractSessionPubkeysFromUserRecords(
      createUserRecordsWithSelfSessions(),
      OUR_PUBKEY
    )

    expect(result).toEqual([PEER_ONE, PEER_TWO])
  })

  it("includes all session pubkeys when our public key is unknown", () => {
    const result = extractSessionPubkeysFromUserRecords(
      createUserRecordsWithSelfSessions()
    )

    expect(result).toEqual([OUR_PUBKEY, PEER_ONE, OUR_PUBKEY, PEER_TWO])
  })
})
