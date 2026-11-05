const LOCAL_RELAY = ["ws://127.0.0.1:7777"]

// Recognize the previous shipped scope without changing anyone's saved list.
export const LEGACY_PRODUCTION_RELAYS = [
  "wss://temp.iris.to/",
  "wss://vault.iris.to/",
  "wss://relay.damus.io/",
  "wss://relay.snort.social/",
  "wss://relay.primal.net/",
  "wss://nos.lol/",
]

const PRODUCTION_RELAYS = [
  LEGACY_PRODUCTION_RELAYS[0],
  "wss://relay.ditto.pub/",
  ...LEGACY_PRODUCTION_RELAYS.slice(1),
]

const TEST_RELAY = ["wss://temp.iris.to/"]

// Indexed text search; ordinary relays may ignore or reject NIP-50 filters.
export const SEARCH_RELAYS = ["wss://search.nos.today/"]

// Metadata directories supplement saved relays for names and NIP-65 discovery.
export const PROFILE_RELAYS = ["wss://purplepag.es/"]

function stripTrailingSlash(url: string) {
  return url.replace(/\/$/, "")
}

function getDefaultRelays(productionRelays = PRODUCTION_RELAYS) {
  if (import.meta.env.VITE_USE_TEST_RELAY) {
    return TEST_RELAY
  }
  if (import.meta.env.VITE_USE_LOCAL_RELAY) {
    return LOCAL_RELAY
  }
  return productionRelays
}

export const DEFAULT_RELAYS = getDefaultRelays()
export const DEFAULT_PRIVATE_RELAYS = getDefaultRelays(LEGACY_PRODUCTION_RELAYS)
export const DEFAULT_WORKER_RELAYS = DEFAULT_RELAYS.map(stripTrailingSlash)
