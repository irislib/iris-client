import {describe, it, expect} from "vitest"
import {parseChatInviteInput, parseLinkInviteInput} from "./linkInvites"

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

describe("parseChatInviteInput", () => {
  it("parses a chat invite URL", () => {
    const payload = {
      inviter: INVITER,
      ephemeralKey: EPHEMERAL,
      sharedSecret: SECRET,
      purpose: "chat",
    }
    const url = `https://iris.to/#${encodeURIComponent(JSON.stringify(payload))}`

    const invite = parseChatInviteInput(url)
    expect(invite).toBeTruthy()
    expect(invite?.inviter).toBe(INVITER)
  })

  it("parses a chat invite without purpose", () => {
    const payload = {
      inviter: INVITER,
      ephemeralKey: EPHEMERAL,
      sharedSecret: SECRET,
    }
    const url = `https://iris.to/#${encodeURIComponent(JSON.stringify(payload))}`

    const invite = parseChatInviteInput(url)
    expect(invite).toBeTruthy()
    expect(invite?.inviterEphemeralPublicKey).toBe(EPHEMERAL)
  })

  it("rejects link-purpose invites", () => {
    const payload = {
      inviter: INVITER,
      ephemeralKey: EPHEMERAL,
      sharedSecret: SECRET,
      purpose: "link",
    }
    const url = `https://iris.to/#${encodeURIComponent(JSON.stringify(payload))}`

    const invite = parseChatInviteInput(url)
    expect(invite).toBeNull()
  })
})

describe("native chat invite formats", () => {
  const payload = {
    inviter: INVITER,
    ephemeralKey: EPHEMERAL,
    sharedSecret: SECRET,
    owner: OWNER,
    purpose: "private",
  }
  it.each([
    "https://chat.iris.to/#/invite/",
    "#/invite/",
    "nostr:https://chat.iris.to/#/invite/",
  ])("accepts the native invite route %s", (prefix) => {
    const invite = parseChatInviteInput(
      prefix + encodeURIComponent(JSON.stringify(payload))
    )
    expect(invite?.inviter).toBe(INVITER)
    expect(invite?.ownerPubkey).toBe(OWNER)
    expect(invite?.sharedSecret).toBe(SECRET)
  })
  it("keeps chat and device linking purposes separate for routed links", () => {
    const url = (purpose: string) =>
      "https://chat.iris.to/#/invite/" +
      encodeURIComponent(JSON.stringify({...payload, purpose}))
    expect(parseLinkInviteInput(url("private"), OWNER)).toBeNull()
    expect(parseChatInviteInput(url("link"))).toBeNull()
    expect(parseLinkInviteInput(url("link"), "e".repeat(64))).toBeNull()
    expect(parseLinkInviteInput(url("link"), OWNER)?.ownerPubkey).toBe(OWNER)
  })
})
