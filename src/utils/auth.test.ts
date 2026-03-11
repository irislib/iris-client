import {describe, expect, it} from "vitest"

import {hasWriteAccessForState, shouldStartPrivateMessagingOnAuthChange} from "./auth"

describe("hasWriteAccessForState", () => {
  it("returns true for linked-device logins", () => {
    expect(hasWriteAccessForState({linkedDevice: true})).toBe(true)
  })

  it("returns true for nip07 logins", () => {
    expect(hasWriteAccessForState({nip07Login: true})).toBe(true)
  })

  it("returns false without any signing capability", () => {
    expect(hasWriteAccessForState({})).toBe(false)
  })
})

describe("shouldStartPrivateMessagingOnAuthChange", () => {
  it("starts when a linked device gains write access after public key is already set", () => {
    expect(
      shouldStartPrivateMessagingOnAuthChange(
        {publicKey: "owner", linkedDevice: true},
        {publicKey: "owner", linkedDevice: false}
      )
    ).toBe(true)
  })

  it("starts when nip07 becomes available after public key is already set", () => {
    expect(
      shouldStartPrivateMessagingOnAuthChange(
        {publicKey: "owner", nip07Login: true},
        {publicKey: "owner", nip07Login: false}
      )
    ).toBe(true)
  })

  it("does not start without write access", () => {
    expect(
      shouldStartPrivateMessagingOnAuthChange({publicKey: "owner"}, {publicKey: ""})
    ).toBe(false)
  })

  it("does not restart when write access was already available", () => {
    expect(
      shouldStartPrivateMessagingOnAuthChange(
        {publicKey: "owner", linkedDevice: true},
        {publicKey: "owner", linkedDevice: true}
      )
    ).toBe(false)
  })
})
