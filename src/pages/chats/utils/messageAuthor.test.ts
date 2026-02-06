import {describe, expect, it} from "vitest"
import {getMessageAuthorPubkey, isMessageFromMe} from "./messageAuthor"

describe("messageAuthor", () => {
  it("prefers ownerPubkey over pubkey", () => {
    expect(getMessageAuthorPubkey({pubkey: "device", ownerPubkey: "owner"})).toBe("owner")
    expect(getMessageAuthorPubkey({pubkey: "only"})).toBe("only")
  })

  it("detects that a message is from me based on ownerPubkey even if pubkey differs", () => {
    const myPubKey = "me"
    expect(isMessageFromMe({pubkey: "device", ownerPubkey: myPubKey}, myPubKey)).toBe(
      true
    )
    expect(isMessageFromMe({pubkey: myPubKey}, myPubKey)).toBe(true)
    expect(
      isMessageFromMe({pubkey: "someone-else", ownerPubkey: "someone-else"}, myPubKey)
    ).toBe(false)
  })
})
