import {describe, expect, it} from "vitest"
import {
  getRecipientProfileRoute,
  getReceiptRecipientsForDisplay,
  normalizeReceiptRecipients,
} from "./receiptRecipients"
import {addUsernameToCache} from "@/utils/usernameCache"

describe("receiptRecipients", () => {
  it("normalizes duplicate recipients by pubkey and keeps earliest timestamp", () => {
    const recipients = normalizeReceiptRecipients([
      {pubkey: "b", timestamp: 2000},
      {pubkey: "a", timestamp: 3000},
      {pubkey: "b", timestamp: 1000},
    ])

    expect(recipients).toEqual([
      {pubkey: "b", timestamp: 1000},
      {pubkey: "a", timestamp: 3000},
    ])
  })

  it("does not list a recipient in both delivered and seen", () => {
    const {deliveredTo, seenBy} = getReceiptRecipientsForDisplay({
      deliveredTo: [
        {pubkey: "a", timestamp: 1000},
        {pubkey: "b", timestamp: 1200},
      ],
      seenBy: [{pubkey: "a", timestamp: 1300}],
    })

    expect(deliveredTo).toEqual([{pubkey: "b", timestamp: 1200}])
    expect(seenBy).toEqual([{pubkey: "a", timestamp: 1300}])
  })

  it("handles missing receipt arrays", () => {
    const {deliveredTo, seenBy} = getReceiptRecipientsForDisplay({
      deliveredTo: undefined,
      seenBy: undefined,
    })

    expect(deliveredTo).toEqual([])
    expect(seenBy).toEqual([])
  })

  it("returns username route for recipients when cached username is verified", () => {
    const pubkey = "c".repeat(64)
    addUsernameToCache(pubkey, "alice@iris.to", true)

    expect(getRecipientProfileRoute(pubkey)).toBe("/alice")
  })
})
