import {describe, expect, it} from "vitest"

import {
  hasOutgoingSessionActivityWithRecipient,
  hasSentMessageInChat,
  isPrivateChatAccepted,
} from "./privateChatAcceptance"

const MY_PUBKEY = "a".repeat(64)
const THEIR_PUBKEY = "b".repeat(64)

describe("privateChatAcceptance", () => {
  it("does not treat receive-only session activity as accepted", () => {
    const userRecords = new Map([
      [
        THEIR_PUBKEY,
        {
          devices: new Map([
            [
              "device-1",
              {
                activeSession: {
                  state: {
                    theirCurrentNostrPublicKey: THEIR_PUBKEY,
                    theirNextNostrPublicKey: "c".repeat(64),
                    sendingChainMessageNumber: 0,
                    previousSendingChainMessageCount: 0,
                    receivingChainMessageNumber: 1,
                  },
                },
                inactiveSessions: [],
              },
            ],
          ]),
        },
      ],
    ])

    expect(hasOutgoingSessionActivityWithRecipient(userRecords, THEIR_PUBKEY)).toBe(false)
    expect(
      isPrivateChatAccepted({
        recipientPubkey: THEIR_PUBKEY,
        isFollowed: false,
        isLocallyAccepted: false,
        sessionUserRecords: userRecords,
      })
    ).toBe(false)
  })

  it("treats outgoing session activity as accepted", () => {
    const userRecords = new Map([
      [
        THEIR_PUBKEY,
        {
          devices: new Map([
            [
              "device-1",
              {
                activeSession: {
                  state: {
                    theirCurrentNostrPublicKey: THEIR_PUBKEY,
                    theirNextNostrPublicKey: "c".repeat(64),
                    sendingChainMessageNumber: 1,
                    previousSendingChainMessageCount: 0,
                  },
                },
                inactiveSessions: [],
              },
            ],
          ]),
        },
      ],
    ])

    expect(hasOutgoingSessionActivityWithRecipient(userRecords, THEIR_PUBKEY)).toBe(true)
    expect(
      isPrivateChatAccepted({
        recipientPubkey: THEIR_PUBKEY,
        isFollowed: false,
        isLocallyAccepted: false,
        sessionUserRecords: userRecords,
      })
    ).toBe(true)
  })

  it("treats prior outgoing session activity as accepted after a ratchet step", () => {
    const userRecords = new Map([
      [
        THEIR_PUBKEY,
        {
          devices: new Map([
            [
              "device-1",
              {
                activeSession: {
                  state: {
                    theirCurrentNostrPublicKey: THEIR_PUBKEY,
                    theirNextNostrPublicKey: "c".repeat(64),
                    sendingChainMessageNumber: 0,
                    previousSendingChainMessageCount: 2,
                  },
                },
                inactiveSessions: [],
              },
            ],
          ]),
        },
      ],
    ])

    expect(hasOutgoingSessionActivityWithRecipient(userRecords, THEIR_PUBKEY)).toBe(true)
  })

  it("treats outgoing chat messages as accepted", () => {
    expect(
      hasSentMessageInChat(
        [{pubkey: THEIR_PUBKEY}, {pubkey: THEIR_PUBKEY, ownerPubkey: MY_PUBKEY}],
        MY_PUBKEY
      )
    ).toBe(true)
  })
})
