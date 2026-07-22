import {describe, expect, it, vi} from "vitest"
import NDK, {NDKEvent, NDKPrivateKeySigner} from "../lib/ndk"
import {verifyRelayEvent} from "./relay-signature-verifier"

async function createSignedEvent() {
  const ndk = new NDK()
  ndk.signer = NDKPrivateKeySigner.generate()
  const event = new NDKEvent(ndk)
  event.kind = 1
  event.content = "valid"
  await event.sign()
  return event
}

describe("verifyRelayEvent", () => {
  it("verifies directly in JavaScript without calling NDK's configured verifier", async () => {
    const event = await createSignedEvent()
    const configuredVerifier = vi.fn()
    event.ndk!.signatureVerificationFunction = configuredVerifier

    expect(verifyRelayEvent(event, null)).toBe(true)
    expect(configuredVerifier).not.toHaveBeenCalled()

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
