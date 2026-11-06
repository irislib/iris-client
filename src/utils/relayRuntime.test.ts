import {describe, expect, it} from "vitest"

import {
  buildWorkerRelayUrls,
  resolveRelayRuntimeConfig,
  resolveActiveRelayScopes,
} from "./relayRuntime"

describe("temporary relay connectivity", () => {
  it("pauses both scopes offline and restores the configured private scope on reconnect", () => {
    const configured = {
      relayUrls: ["wss://old.test/", "wss://new-public.test/"],
      privateRelayUrls: ["wss://old.test/"],
      pausedRelayUrls: [],
    }
    expect(resolveActiveRelayScopes({...configured, offline: true})).toEqual({
      relayUrls: [],
      privateRelayUrls: [],
    })
    expect(resolveActiveRelayScopes({...configured, offline: false})).toEqual({
      relayUrls: configured.relayUrls,
      privateRelayUrls: configured.privateRelayUrls,
    })
    expect(configured.privateRelayUrls).toEqual(["wss://old.test/"])
  })

  it("filters paused relays from both scopes and retains explicit empty private choices", () => {
    const configured = {
      relayUrls: ["wss://old.test/", "wss://new-public.test/"],
      privateRelayUrls: ["wss://old.test/"],
      pausedRelayUrls: ["wss://old.test"],
      offline: false,
    }
    expect(resolveActiveRelayScopes(configured)).toEqual({
      relayUrls: ["wss://new-public.test/"],
      privateRelayUrls: [],
    })
    expect(
      resolveActiveRelayScopes({...configured, pausedRelayUrls: [], privateRelayUrls: []})
    ).toEqual({relayUrls: configured.relayUrls, privateRelayUrls: []})
  })

  it("keeps changed settings and reconnect requests paused until online, preserving legacy coupling", () => {
    const updated = {
      relayUrls: ["wss://added.test/"],
      privateRelayUrls: ["wss://private.test/"],
      pausedRelayUrls: [],
      offline: true,
    }
    expect(resolveActiveRelayScopes(updated)).toEqual({
      relayUrls: [],
      privateRelayUrls: [],
    })
    expect(resolveActiveRelayScopes({...updated, privateRelayUrls: undefined})).toEqual({
      relayUrls: [],
      privateRelayUrls: undefined,
    })
    expect(
      resolveActiveRelayScopes({...updated, offline: false, privateRelayUrls: undefined})
    ).toEqual({relayUrls: updated.relayUrls, privateRelayUrls: undefined})
  })
})

describe("relay runtime selection", () => {
  it("keeps fresh private defaults separate, including explicit empty private choices", () => {
    const options = {
      enabledRelayUrls: ["wss://old.test/", "wss://relay.ditto.pub/"],
      forceLocalRelayEnv: false,
      storeNdkOutboxModel: false,
      storeAutoConnectUserRelays: false,
    }
    expect(
      resolveRelayRuntimeConfig({...options, privateRelayUrls: ["wss://old.test/"]})
    ).toMatchObject({
      relayUrls: options.enabledRelayUrls,
      privateRelayUrls: ["wss://old.test/"],
    })
    expect(
      resolveRelayRuntimeConfig({...options, privateRelayUrls: []}).privateRelayUrls
    ).toEqual([])
    expect(resolveRelayRuntimeConfig(options).privateRelayUrls).toEqual(
      options.enabledRelayUrls
    )
    expect(
      resolveRelayRuntimeConfig({
        ...options,
        privateRelayUrls: ["wss://old.test/"],
        injectedHtreeRelayUrl: "ws://127.0.0.1:7777",
      }).privateRelayUrls
    ).toEqual(["ws://127.0.0.1:7777"])
  })
  it("keeps an intentionally empty relay scope offline", () => {
    const config = resolveRelayRuntimeConfig({
      enabledRelayUrls: [],
      forceLocalRelayEnv: false,
      storeNdkOutboxModel: true,
      storeAutoConnectUserRelays: true,
    })
    expect(config.relayUrls).toEqual([])
    expect(config.enableOutboxModel).toBe(false)
    expect(config.autoConnectUserRelays).toBe(false)
    expect(config.disableExtraRelayUrls).toBe(true)
    expect(
      buildWorkerRelayUrls({
        relayUrls: config.relayUrls,
        defaultRelayUrls: ["wss://default.test"],
        extraRelayUrls: ["wss://discovery.test"],
        disableExtraRelayUrls: config.disableExtraRelayUrls,
      })
    ).toEqual([])
  })

  it("uses worker defaults only when no relay scope was supplied", () => {
    expect(
      buildWorkerRelayUrls({
        defaultRelayUrls: ["wss://default.test"],
      })
    ).toEqual(["wss://default.test"])
    expect(
      buildWorkerRelayUrls({
        relayUrls: [],
        defaultRelayUrls: ["wss://default.test"],
      })
    ).toEqual([])
  })

  it("pins Iris shell runtimes to the injected local relay", () => {
    const config = resolveRelayRuntimeConfig({
      enabledRelayUrls: ["wss://relay.damus.io/", "wss://relay.snort.social/"],
      explicitRelayUrls: undefined,
      injectedHtreeRelayUrl: "ws://127.0.0.1:21417/ws",
      forceLocalRelayEnv: false,
      storeNdkOutboxModel: true,
      storeAutoConnectUserRelays: true,
    })

    expect(config.relayUrls).toEqual(["ws://127.0.0.1:21417/ws"])
    expect(config.explicitRelayUrls).toEqual(["ws://127.0.0.1:21417/ws"])
    expect(config.pinnedRelayUrls).toEqual(["ws://127.0.0.1:21417/ws"])
    expect(config.enableOutboxModel).toBe(false)
    expect(config.autoConnectUserRelays).toBe(false)
    expect(config.disableExtraRelayUrls).toBe(true)
  })

  it("disables outbox and extra relays in explicit local relay mode", () => {
    const config = resolveRelayRuntimeConfig({
      enabledRelayUrls: ["ws://127.0.0.1:7777"],
      explicitRelayUrls: ["ws://127.0.0.1:7777"],
      injectedHtreeRelayUrl: null,
      forceLocalRelayEnv: true,
      storeNdkOutboxModel: true,
      storeAutoConnectUserRelays: true,
    })

    expect(config.relayUrls).toEqual(["ws://127.0.0.1:7777"])
    expect(config.explicitRelayUrls).toEqual(["ws://127.0.0.1:7777"])
    expect(config.pinnedRelayUrls).toBeNull()
    expect(config.enableOutboxModel).toBe(false)
    expect(config.autoConnectUserRelays).toBe(false)
    expect(config.disableExtraRelayUrls).toBe(true)
  })

  it("preserves configured relay behavior outside local relay runtimes", () => {
    const config = resolveRelayRuntimeConfig({
      enabledRelayUrls: ["wss://relay.damus.io/", "wss://relay.snort.social/"],
      explicitRelayUrls: undefined,
      injectedHtreeRelayUrl: null,
      forceLocalRelayEnv: false,
      storeNdkOutboxModel: true,
      storeAutoConnectUserRelays: false,
    })

    expect(config.relayUrls).toEqual([
      "wss://relay.damus.io/",
      "wss://relay.snort.social/",
    ])
    expect(config.explicitRelayUrls).toEqual([
      "wss://relay.damus.io/",
      "wss://relay.snort.social/",
    ])
    expect(config.pinnedRelayUrls).toBeNull()
    expect(config.enableOutboxModel).toBe(true)
    expect(config.autoConnectUserRelays).toBe(false)
    expect(config.disableExtraRelayUrls).toBe(false)
  })

  it("omits worker extra relays when runtime is pinned to the local relay", () => {
    expect(
      buildWorkerRelayUrls({
        relayUrls: ["ws://127.0.0.1:21417/ws"],
        defaultRelayUrls: ["wss://relay.damus.io", "wss://relay.snort.social"],
        extraRelayUrls: ["wss://search.example"],
        disableExtraRelayUrls: true,
      })
    ).toEqual(["ws://127.0.0.1:21417/ws"])
  })

  it("still appends worker extra relays in normal runtimes", () => {
    expect(
      buildWorkerRelayUrls({
        relayUrls: ["wss://relay.damus.io"],
        defaultRelayUrls: ["wss://relay.snort.social"],
        extraRelayUrls: ["wss://search.example"],
        disableExtraRelayUrls: false,
      })
    ).toEqual(["wss://relay.damus.io", "wss://search.example"])
  })
})
