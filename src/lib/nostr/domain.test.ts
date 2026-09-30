import {describe, it, expect, vi} from "vitest"
import {nip19, verifyEvent} from "nostr-tools"
import NostrClient, {
  AppEvent,
  SecretKeySigner,
  profileFromEvent,
  Relay,
  EventSubscription,
} from "./index"
import {relayHints} from "./relayPolicy"

describe("app event and account semantics", () => {
  it("returns an exact post as soon as the worker delivers it and closes its interest", async () => {
    const client = new NostrClient({signer: SecretKeySigner.generate()})
    const post = new AppEvent(client, {kind: 1, content: "Already available"})
    await post.sign()
    let subscription!: EventSubscription
    client.transportPlugins.push({
      onSubscribe: (sub) => {
        subscription = sub
      },
    })
    try {
      const result = client.fetchEvent(post.id)
      await Promise.resolve()
      subscription.eventReceived(post)
      const delivered = await Promise.race([
        result,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
      ])
      expect(delivered?.id).toBe(post.id)
      expect(subscription.closed).toBe(true)
    } finally {
      subscription.eoseReceived()
      await client.close()
    }
  })
  it.each(["replaceable", "prefix", "multiple IDs"])(
    "waits for history before choosing a %s result",
    async (kind) => {
      const client = new NostrClient({signer: SecretKeySigner.generate()})
      const old = new AppEvent(client, {kind: 0, created_at: 100, content: "Old"})
      const latest = new AppEvent(client, {kind: 0, created_at: 101, content: "Latest"})
      await old.sign()
      await latest.sign()
      const filter =
        kind === "replaceable"
          ? {kinds: [0], authors: [old.pubkey]}
          : kind === "prefix"
            ? {ids: [old.id.slice(0, 8)]}
            : {ids: [old.id, latest.id]}
      let subscription!: EventSubscription
      client.transportPlugins.push({
        onSubscribe: (sub) => {
          subscription = sub
        },
      })
      let settled = false
      const result = client.fetchEvent(filter).then((event) => {
        settled = true
        return event
      })
      await Promise.resolve()
      subscription.eventReceived(old)
      await Promise.resolve()
      expect(settled).toBe(false)
      if (kind !== "prefix") subscription.eventReceived(latest)
      subscription.eoseReceived()
      expect((await result)?.id).toBe(kind === "prefix" ? old.id : latest.id)
      await client.close()
    }
  )
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
