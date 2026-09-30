import {describe, expect, it, vi} from "vitest"
import NostrClient, {AppEvent, SecretKeySigner} from "@/lib/nostr"
import {verifyRelayEvent} from "./relay-signature-verifier"

async function createSignedEvent() {
  const nostr = new NostrClient()
  nostr.signer = SecretKeySigner.generate()
  const event = new AppEvent(nostr)
  event.kind = 1
  event.content = "valid"
  await event.sign()
  return event
}

describe("verifyRelayEvent", () => {
  it("verifies app and plain events directly in JavaScript", async () => {
    const event = await createSignedEvent()

    expect(verifyRelayEvent(event, null)).toBe(true)
    expect(verifyRelayEvent(event.rawEvent(), null)).toBe(true)

    event.content = "tampered"
    expect(verifyRelayEvent(event, null)).toBe(false)
  })

  it("uses the loaded WASM verifier", async () => {
    const event = await createSignedEvent()
    const verifyEvent = vi.fn()

    expect(verifyRelayEvent(event, {verifyEvent})).toBe(true)
    expect(verifyEvent).toHaveBeenCalledOnce()

    verifyEvent.mockImplementation(() => {
      throw new Error("invalid signature")
    })
    expect(verifyRelayEvent(event, {verifyEvent})).toBe(false)
  })
})
