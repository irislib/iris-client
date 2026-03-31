const LOCAL_RELAY = ["ws://127.0.0.1:7777"]

const PRODUCTION_RELAYS = [
  "wss://temp.iris.to/",
  "wss://vault.iris.to/",
  "wss://relay.damus.io/",
  "wss://relay.snort.social/",
  "wss://relay.primal.net/",
]

const TEST_RELAY = ["wss://temp.iris.to/"]

function stripTrailingSlash(url: string) {
  return url.replace(/\/$/, "")
}

function getDefaultRelays() {
  if (import.meta.env.VITE_USE_TEST_RELAY) {
    return TEST_RELAY
  }
  if (import.meta.env.VITE_USE_LOCAL_RELAY) {
    return LOCAL_RELAY
  }
  return PRODUCTION_RELAYS
}

export const DEFAULT_RELAYS = getDefaultRelays()
export const DEFAULT_WORKER_RELAYS = DEFAULT_RELAYS.map(stripTrailingSlash)
