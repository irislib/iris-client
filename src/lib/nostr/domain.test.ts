import {describe, it, expect, vi} from "vitest"
import {nip19, verifyEvent} from "nostr-tools"
import NostrClient, {AppEvent, SecretKeySigner, profileFromEvent, Relay} from "./index"
import {relayHints} from "./relayPolicy"

describe("app event and account semantics", () => {
  it("routes confirmed writes through the attached worker without another runtime", async () => {
    const client = new NostrClient()
    const publish = vi.fn().mockResolvedValue({remoteAccepted: true})
    client.transportPlugins.push({publish})
    const runtime = vi.spyOn(client, "getRuntime")
    const relay = new Relay("wss://wallet.example", undefined, client)
    const event = new AppEvent(client, {kind: 23194})
    expect(await relay.publish(event)).toBe(true)
    expect(publish).toHaveBeenCalledWith(event, [relay], {requireAck: true})
    expect(runtime).not.toHaveBeenCalled()
  })
  it("restores the existing hex/nsec account and preserves both chat encryption schemes", async () => {
    const original = SecretKeySigner.generate()
    const restored = new SecretKeySigner(original.privateKey)
    const nsec = new SecretKeySigner(
      nip19.nsecEncode(
        Uint8Array.from(original.privateKey.match(/../g)!, (v) => parseInt(v, 16))
      )
    )
    expect(restored.pubkey).toBe(original.pubkey)
    expect(nsec.pubkey).toBe(original.pubkey)
    const recipient = SecretKeySigner.generate()
    for (const scheme of ["nip04", "nip44"] as const) {
      const ciphertext = await restored.encrypt(
        await recipient.user(),
        "saved session message",
        scheme
      )
      expect(await recipient.decrypt(await original.user(), ciphertext, scheme)).toBe(
        "saved session message"
      )
    }
  })
  it("signs public mentions once and never derives mention tags from encrypted content", async () => {
    const signer = SecretKeySigner.generate()
    const client = new NostrClient({signer})
    const recipient = SecretKeySigner.generate().pubkey
    const text = `Hello nostr:${nip19.npubEncode(recipient)}`
    const publicEvent = new AppEvent(client, {kind: 1, content: text})
    await publicEvent.sign()
    await publicEvent.sign()
    expect(publicEvent.tags).toEqual([["p", recipient]])
    expect(verifyEvent(publicEvent.rawEvent())).toBe(true)
    const privateEvent = new AppEvent(client, {kind: 4, content: text})
    await privateEvent.sign()
    expect(privateEvent.tags).toEqual([])
  })
  it("retains signed metadata for profile edits and admits bounded NIP65 relay hints", async () => {
    const signer = SecretKeySigner.generate()
    const event = new AppEvent(new NostrClient({signer}), {
      kind: 0,
      content: JSON.stringify({name: "Saved profile", custom: "retained"}),
    })
    await event.sign()
    const profile = profileFromEvent(event)
    expect(JSON.parse(profile.profileEvent!).id).toBe(event.id)
    expect(profile.created_at).toBe(event.created_at)
    expect(profile.custom).toBe("retained")
    const hints = new AppEvent(undefined, {
      kind: 10002,
      pubkey: signer.pubkey,
      tags: [
        ["r", "javascript:bad"],
        ["r", "wss://read.example", "read"],
        ["r", "wss://write.example", "write"],
        ["r", "wss://shared.example"],
      ],
    })
    expect(relayHints([hints], "write")).toEqual([
      "wss://write.example",
      "wss://shared.example",
    ])
  })
})
