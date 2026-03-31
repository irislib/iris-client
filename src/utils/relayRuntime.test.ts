import {describe, expect, it} from "vitest"

import {
  buildWorkerRelayUrls,
  resolveRelayRuntimeConfig,
} from "./relayRuntime"

describe("relay runtime selection", () => {
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

    expect(config.relayUrls).toEqual(["wss://relay.damus.io/", "wss://relay.snort.social/"])
    expect(config.explicitRelayUrls).toEqual(["wss://relay.damus.io/", "wss://relay.snort.social/"])
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
