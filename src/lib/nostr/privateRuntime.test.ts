import {afterEach, expect, it, vi} from "vitest"
import {WebSocket} from "ws"
import {finalizeEvent, generateSecretKey, getPublicKey, verifyEvent} from "nostr-tools"
import {AppKeys, Invite, Session} from "nostr-double-ratchet"
import NostrClient from "./index"
import {EventCache} from "./cache"
import {db} from "./db"
import {RuntimeRelayFixture, until} from "./privateRelayTestFixture"
import type {NostrEvent} from "nostr-pubsub"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  await Promise.all([
    db.events.clear(),
    db.unpublishedEvents.clear(),
    db.privateUnpublishedEvents.clear(),
  ])
  vi.unstubAllGlobals()
})

it("keeps new public relays out of private reads, delivery and authorization until explicitly selected", async () => {
  vi.stubGlobal("WebSocket", WebSocket)
  const original = new RuntimeRelayFixture()
  const addedPublic = new RuntimeRelayFixture()
  const oldUrl = await original.url()
  const newUrl = await addedPublic.url()
  cleanup.push(
    () => original.close(),
    () => addedPublic.close()
  )
  const identity = generateSecretKey()
  const owner = getPublicKey(identity)
  const client = new NostrClient({
    explicitRelayUrls: [oldUrl, newUrl],
    privateRelayUrls: [oldUrl],
    cacheAdapter: new EventCache(),
  })
  cleanup.push(() => client.close())
  const runtime = client.getRuntime()
  runtime.subscribe([{kinds: [1]}], {onEvent() {}}, {cache: "network-only"})
  runtime.subscribePrivate(
    [{kinds: [1060], authors: [owner]}],
    {onEvent() {}},
    {cache: "network-only"}
  )
  runtime.subscribePrivate(
    [{kinds: [37368], authors: [owner]}],
    {onEvent() {}},
    {cache: "network-only"}
  )
  const activeKinds = (relay: RuntimeRelayFixture) =>
    [...relay.clients.values()].flatMap((subscriptions) =>
      [...subscriptions.values()].flatMap((filters) =>
        filters.flatMap((filter) => filter.kinds ?? [])
      )
    )
  await until(
    () =>
      activeKinds(original).includes(1060) &&
      activeKinds(original).includes(37368) &&
      activeKinds(addedPublic).includes(1)
  )
  expect(activeKinds(addedPublic)).not.toContain(1060)
  expect(activeKinds(addedPublic)).not.toContain(37368)
  const publicPost = finalizeEvent(
    {kind: 1, content: "public fixture", tags: [], created_at: 100},
    identity
  )
  await runtime.publish(publicPost, {requireAck: true})
  await until(() => addedPublic.events.some((event) => event.id === publicPost.id))
  const privatePost = Session.init(
    getPublicKey(generateSecretKey()),
    generateSecretKey(),
    true,
    generateSecretKey()
  ).sendEvent({kind: 14, content: "private fixture"}, [["p", owner]]).event
  await runtime.publish(privatePost, {relays: [oldUrl, newUrl], requireAck: true})
  const authorization = finalizeEvent(
    {kind: 37368, content: "authorization fixture", tags: [], created_at: 100},
    identity
  )
  await runtime.publishPrivate(authorization, {requireAck: true})
  await until(
    () =>
      original.events.some((event) => event.id === privatePost.id) &&
      original.events.some((event) => event.id === authorization.id)
  )
  expect(
    addedPublic.events.some((event) =>
      [privatePost.id, authorization.id].includes(event.id)
    )
  ).toBe(false)

  client.setPrivateRelays([newUrl])
  await until(
    () => activeKinds(addedPublic).includes(1060) && !activeKinds(original).includes(1060)
  )
  client.setPrivateRelays([])
  await until(
    () =>
      !activeKinds(addedPublic).includes(1060) &&
      !activeKinds(addedPublic).includes(37368)
  )
  const offlineAuthorization = finalizeEvent(
    {kind: 37368, content: "offline authorization", tags: [], created_at: 101},
    identity
  )
  const result = await runtime.publishPrivate(offlineAuthorization, {
    relays: [oldUrl, newUrl],
    requireAck: true,
  })
  expect(result.remoteAccepted).toBe(false)
  expect(
    [...original.events, ...addedPublic.events].some(
      (event) => event.id === offlineAuthorization.id
    )
  ).toBe(false)
})

it("keeps broad public group discovery available without weakening private subject scopes", async () => {
  vi.stubGlobal("WebSocket", WebSocket)
  const relay = new RuntimeRelayFixture()
  await relay.url()
  cleanup.push(() => relay.close())
  const event = finalizeEvent(
    {
      kind: 37368,
      created_at: Math.floor(Date.now() / 1000),
      content: "public group directory",
      tags: [["t", "iris-group"]],
    },
    generateSecretKey()
  )
  relay.events.push(event)
  const client = new NostrClient({
    explicitRelayUrls: [await relay.url()],
    cacheAdapter: new EventCache(),
  })
  cleanup.push(() => client.close())
  const runtime = client.getRuntime()
  const seen: string[] = []
  const subscription = runtime.subscribe(
    [{kinds: [37368], "#t": ["iris-group"], limit: 100}],
    {
      onEvent: (event) => {
        seen.push(event.id)
      },
    },
    {cache: "network-only"}
  )
  cleanup.push(async () => subscription.close())
  await until(() => seen.includes(event.id))
  expect(relay.requests).toContainEqual([
    {kinds: [37368], "#t": ["iris-group"], limit: 100},
  ])
  expect(() => runtime.subscribe([{kinds: [37368]}], {onEvent() {}})).toThrow()
  expect(() =>
    runtime.subscribe(
      [{kinds: [37368], "#t": ["iris-group"], "#p": [getPublicKey(generateSecretKey())]}],
      {onEvent() {}}
    )
  ).not.toThrow()
  // A recipient selector always goes through anonymous scoped discovery.
  await until(() => relay.requests.length >= 2)
  expect(relay.frames.size).toBeGreaterThan(1)
})

it("keeps first contact, sibling/group copies and retries off account and discovery connections", async () => {
  vi.stubGlobal("WebSocket", WebSocket)
  const relay = new RuntimeRelayFixture()
  await relay.url()
  relay.requireAuth = true
  cleanup.push(() => relay.close())
  const identity = generateSecretKey(),
    owner = getPublicKey(identity)
  const peer = getPublicKey(generateSecretKey()),
    device = getPublicKey(generateSecretKey())
  const ownDeviceSecret = generateSecretKey()
  const ownDevice = getPublicKey(ownDeviceSecret),
    groupDevice = getPublicKey(generateSecretKey())
  const cache = new EventCache()
  const client = new NostrClient({
    explicitRelayUrls: [await relay.url()],
    cacheAdapter: cache,
    signAuthEvent: async (_url, template) => finalizeEvent(template, identity),
  })
  cleanup.push(() => client.close())
  const runtime = client.getRuntime()
  const ownInvite = Invite.createNew(owner, ownDevice)
  const appKeys = new AppKeys([
    {identityPubkey: ownDevice, createdAt: Math.floor(Date.now() / 1000)},
  ])
  const proof = finalizeEvent(appKeys.getEvent({ownerPubkey: owner}), identity)
  const bootstrap = await Invite.createNew(peer, device).accept(
    ownDevice,
    ownDeviceSecret,
    owner,
    proof
  )
  expect(bootstrap.event.tags.filter((tag) => tag[0] === "owner-proof")).toHaveLength(1)
  const sealed = bootstrap.session.sendEvent({kind: 14, content: "private message"}, [
    ["p", device],
  ]).event
  const sealFor = (recipient: string) =>
    Session.init(
      getPublicKey(generateSecretKey()),
      generateSecretKey(),
      true,
      generateSecretKey()
    ).sendEvent({kind: 21113, content: "encrypted group wake"}, [["p", recipient]]).event
  const envelopes = [bootstrap.event, sealed, sealFor(ownDevice), sealFor(groupDevice)]
  runtime.subscribe(
    [{kinds: [1059], "#p": [ownInvite.inviterEphemeralPublicKey]}],
    {onEvent() {}},
    {cache: "network-only"}
  )
  const discovery = runtime.subscribe(
    [
      {kinds: [37368], authors: [owner, peer]},
      {kinds: [30078], authors: [peer], "#l": ["double-ratchet/invites"]},
      {kinds: [37368], "#p": [device]},
      {kinds: [0, 10002, 10050], authors: [owner, peer, groupDevice]},
      {kinds: [0, 10013], authors: [owner]},
    ],
    {onEvent() {}},
    {cache: "network-only"}
  )
  cleanup.push(async () => discovery.close())
  relay.acknowledge = false
  expect((await runtime.publish(sealed)).queued).toBe(true)
  relay.acknowledge = true
  const publicInvite = finalizeEvent(ownInvite.getEvent(), identity)
  expect((await runtime.publish(publicInvite, {requireAck: true})).accepted).toBe(true)
  for (const event of envelopes)
    expect((await runtime.publish(event, {requireAck: true})).accepted).toBe(true)
  await until(
    () =>
      new Set(
        relay.requests
          .flat()
          .filter((filter) => filter.kinds?.includes(10050))
          .flatMap((filter) => filter.authors ?? [])
      ).size === 3
  )
  const privateIds = new Set(envelopes.map((event) => event.id))
  const privateConnections = [...relay.frames.values()].filter((frames) =>
    frames.some(
      (frame) => frame[0] === "EVENT" && privateIds.has((frame[1] as NostrEvent).id)
    )
  )
  expect(privateConnections).toHaveLength(5)
  const keys = new Set<string>()
  for (const frames of privateConnections) {
    expect(frames.every((frame) => frame[0] === "AUTH" || frame[0] === "EVENT")).toBe(
      true
    )
    const auth = frames.find((frame) => frame[0] === "AUTH")?.[1] as NostrEvent
    expect(verifyEvent(auth)).toBe(true)
    expect([owner, peer, device, ownDevice, groupDevice]).not.toContain(auth.pubkey)
    expect(keys.has(auth.pubkey)).toBe(false)
    keys.add(auth.pubkey)
    const sent = frames
      .filter((frame) => frame[0] === "EVENT")
      .map((frame) => frame[1] as NostrEvent)
    expect(new Set(sent.map((event) => event.id)).size).toBe(1)
    expect(sent.every((event) => ![owner, peer].includes(event.pubkey))).toBe(true)
    expect(JSON.stringify(frames)).not.toContain(owner)
    expect(JSON.stringify(frames)).not.toContain(peer)
  }
  for (const frames of relay.frames.values()) {
    const filters = frames
      .filter((frame) => frame[0] === "REQ")
      .flatMap((frame) => frame.slice(2)) as Array<{authors?: string[]; "#p"?: string[]}>
    if (!filters.length) continue
    const scope = new Set(
      filters.flatMap((filter) => filter.authors ?? filter["#p"] ?? [])
    )
    const auth = frames.find((frame) => frame[0] === "AUTH")?.[1] as NostrEvent
    if (auth.pubkey === owner) {
      expect(
        [...scope].every((key) =>
          [owner, ownInvite.inviterEphemeralPublicKey].includes(key)
        )
      ).toBe(true)
      expect(
        frames
          .filter((frame) => frame[0] === "EVENT")
          .every((frame) => (frame[1] as NostrEvent).id === publicInvite.id)
      ).toBe(true)
    } else {
      expect(scope.size).toBe(1)
      expect(frames.some((frame) => frame[0] === "EVENT")).toBe(false)
      expect(auth.pubkey).not.toBe(owner)
    }
  }
  const cached = await runtime.query([{ids: [...privateIds]}], {cache: "cache-only"})
  expect(new Set(cached.events.map((event) => event.id))).toEqual(privateIds)
})

it("migrates valid durable sends while keeping retired shared traffic quarantined through restart", async () => {
  vi.stubGlobal("WebSocket", WebSocket)
  const relay = new RuntimeRelayFixture()
  await relay.url()
  cleanup.push(() => relay.close())
  const owner = getPublicKey(generateSecretKey()),
    device = getPublicKey(generateSecretKey())
  const session = Session.init(
    getPublicKey(generateSecretKey()),
    generateSecretKey(),
    true,
    generateSecretKey()
  )
  const sealed = session.sendEvent({kind: 14, content: "saved before restart"}, [
    ["p", device],
  ]).event
  const sign = (kind: number, tags: string[][]) =>
    finalizeEvent(
      {kind, tags, content: "retired", created_at: Math.floor(Date.now() / 1000)},
      generateSecretKey()
    )
  const retired = [
    sign(1060, [["v", "2"]]),
    sign(1060, [["p", device]]),
    sign(37368, [
      ["type", "group_roster"],
      ["member", owner],
      ["member", device],
    ]),
    sign(21111, [["p", device]]),
  ]
  const first = new EventCache()
  for (const event of [sealed, ...retired])
    await first.store.putPending({event, attempts: 1, updatedAt: 1})
  const cache = new EventCache()
  const client = new NostrClient({
    explicitRelayUrls: [await relay.url()],
    cacheAdapter: cache,
  })
  cleanup.push(() => client.close())
  const runtime = client.getRuntime()
  await until(() => relay.events.some((event) => event.id === sealed.id))
  await runtime.retryPending()
  expect(relay.events.map((event) => event.id)).toEqual([sealed.id])
  const quarantined = [
    ...(await cache.store.listPending()),
    ...(await cache.privateStore.listPending()),
  ]
  expect(new Set(quarantined.map((entry) => entry.event.id))).toEqual(
    new Set(retired.map((event) => event.id))
  )
  expect(await runtime.store.listPending()).toEqual([])
  for (const event of retired)
    await expect(
      runtime.publish(event, {requireAck: true, queue: false})
    ).rejects.toThrow()
})
