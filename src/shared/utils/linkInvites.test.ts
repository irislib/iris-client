import {describe, it, expect} from "vitest"
import {parseLinkInviteInput} from "./linkInvites"

const OWNER = "a".repeat(64)
const INVITER = "b".repeat(64)
const EPHEMERAL = "c".repeat(64)
const SECRET = "d".repeat(64)

describe("parseLinkInviteInput", () => {
  it("parses a full link URL", () => {
    const payload = {
      inviter: INVITER,
      ephemeralKey: EPHEMERAL,
      sharedSecret: SECRET,
      purpose: "link",
    }
    const url = `https://iris.to/#${encodeURIComponent(JSON.stringify(payload))}`
    const invite = parseLinkInviteInput(url, OWNER)

    expect(invite).toBeTruthy()
    expect(invite?.inviter).toBe(INVITER)
    expect(invite?.inviterEphemeralPublicKey).toBe(EPHEMERAL)
  })

  it("parses raw JSON with inviterEphemeralPublicKey", () => {
    const payload = {
      inviter: INVITER,
      inviterEphemeralPublicKey: EPHEMERAL,
      sharedSecret: SECRET,
      purpose: "link",
    }
    const raw = JSON.stringify(payload)
    const invite = parseLinkInviteInput(raw, OWNER)

    expect(invite).toBeTruthy()
    expect(invite?.inviterEphemeralPublicKey).toBe(EPHEMERAL)
  })

  it("parses link URL with inviterEphemeralPublicKey", () => {
    const payload = {
      inviter: INVITER,
      inviterEphemeralPublicKey: EPHEMERAL,
      sharedSecret: SECRET,
      purpose: "link",
    }
    const url = `https://iris.to/#${encodeURIComponent(JSON.stringify(payload))}`
    const invite = parseLinkInviteInput(url, OWNER)

    expect(invite).toBeTruthy()
    expect(invite?.inviterEphemeralPublicKey).toBe(EPHEMERAL)
  })

  it("parses link URL without purpose field", () => {
    const payload = {
      inviter: INVITER,
      ephemeralKey: EPHEMERAL,
      sharedSecret: SECRET,
    }
    const url = `https://iris.to/#${encodeURIComponent(JSON.stringify(payload))}`
    const invite = parseLinkInviteInput(url, OWNER)

    expect(invite).toBeTruthy()
    expect(invite?.inviterEphemeralPublicKey).toBe(EPHEMERAL)
  })

  it("rejects non-link invites", () => {
    const payload = {
      inviter: INVITER,
      ephemeralKey: EPHEMERAL,
      sharedSecret: SECRET,
      purpose: "chat",
    }
    const url = `https://iris.to/#${encodeURIComponent(JSON.stringify(payload))}`
    const invite = parseLinkInviteInput(url, OWNER)

    expect(invite).toBeNull()
  })

  it("rejects mismatched owner", () => {
    const payload = {
      inviter: INVITER,
      ephemeralKey: EPHEMERAL,
      sharedSecret: SECRET,
      purpose: "link",
      owner: "e".repeat(64),
    }
    const url = `https://iris.to/#${encodeURIComponent(JSON.stringify(payload))}`
    const invite = parseLinkInviteInput(url, OWNER)

    expect(invite).toBeNull()
  })
})
