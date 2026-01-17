#!/usr/bin/env tsx

import debug from "debug"

debug.enable("ndk,ndk:outbox-tracker")

const log = debug("ndk:relay")
const error = debug("ndk:relay:error")

import type {NDKEvent} from "./events/index.js"
import {NDKKind} from "./events/kinds/index.js"
import {NDK} from "./ndk/index.js"
import type {NDKRelay} from "./relay/index.js"
import type {NDKFilter} from "./subscription/index.js"

const npub = process.argv[2]

if (!npub) {
  error("Usage: tsx test-relay-autoconnect.ts <npub>")
  process.exit(1)
}

const ndk = new NDK({
  enableOutboxModel: true,
  netDebug: (msg, relay, direction) => {
    log(`[${direction}] ${relay.url}: ${msg}`)
  },
})

log("NDK created with outbox model enabled")

const eventsPerRelay = new Map<string, number>()
const connectedRelays = new Set<string>()

// Main pool events
ndk.pool.on("relay:connecting", (relay: NDKRelay) => {
  log(`⟳ [Main Pool] Connecting to relay: ${relay.url}`)
})

ndk.pool.on("relay:connect", (relay: NDKRelay) => {
  connectedRelays.add(relay.url)
  log(`✓ [Main Pool] Connected to relay: ${relay.url}`)
  log(`Total connected relays: ${connectedRelays.size}`)
})

ndk.pool.on("relay:disconnect", (relay: NDKRelay) => {
  connectedRelays.delete(relay.url)
  log(`✗ [Main Pool] Disconnected from relay: ${relay.url}`)
  log(`Total connected relays: ${connectedRelays.size}`)
})

// Outbox pool events
if (ndk.outboxPool) {
  ndk.outboxPool.on("relay:connecting", (relay: NDKRelay) => {
    log(`⟳ [Outbox Pool] Connecting to relay: ${relay.url}`)
  })

  ndk.outboxPool.on("relay:connect", (relay: NDKRelay) => {
    connectedRelays.add(relay.url)
    log(`✓ [Outbox Pool] Connected to relay: ${relay.url}`)
    log(`Total connected relays: ${connectedRelays.size}`)
  })

  ndk.outboxPool.on("relay:disconnect", (relay: NDKRelay) => {
    connectedRelays.delete(relay.url)
    log(`✗ [Outbox Pool] Disconnected from relay: ${relay.url}`)
    log(`Total connected relays: ${connectedRelays.size}`)
  })
}

async function run() {
  log(`Fetching user: ${npub}`)

  const user = await ndk.fetchUser(npub)

  if (!user) {
    error("User not found")
    process.exit(1)
  }

  log(`Found user: ${user.npub}`)
  log(`User pubkey: ${user.pubkey}`)
  log(`User profile: ${user.profile?.name || user.profile?.displayName || "Unknown"}`)

  const filter: NDKFilter = {
    kinds: [NDKKind.Text],
    authors: [user.pubkey],
  }

  log("\nStarting subscription for notes...")
  log(`Filter:`, JSON.stringify(filter, null, 2))

  const sub = ndk.subscribe(filter, {closeOnEose: false})

  log("\nWaiting 2 seconds before connecting to NDK...")
  await new Promise((resolve) => setTimeout(resolve, 2000))

  log("\nConnecting to NDK...")
  ndk.connect(5000)
  log("NDK connect initiated")

  log(`\nMain pool relays: ${ndk.pool.relays.size}`)
  log(`Outbox pool relays: ${ndk.outboxPool?.relays.size || 0}`)

  sub.on("event", (event: NDKEvent) => {
    const relay = event.relay
    if (relay) {
      const count = eventsPerRelay.get(relay.url) || 0
      eventsPerRelay.set(relay.url, count + 1)
    }
  })

  sub.on("eose", () => {
    log("\nEnd of stored events")
    log("\nFinal stats:")
    log(`Connected relays: ${connectedRelays.size}`)
    log(
      `Total events received: ${Array.from(eventsPerRelay.values()).reduce((a, b) => a + b, 0)}`
    )
    log("\nEvents per relay:")
    for (const [relayUrl, eventCount] of eventsPerRelay.entries()) {
      log(`  ${relayUrl}: ${eventCount}`)
    }
  })

  // Keep the script running
  process.on("SIGINT", () => {
    log("\n\nShutting down...")
    sub.stop()
    // Disconnect all relays
    for (const relay of ndk.pool.relays.values()) {
      relay.disconnect()
    }
    process.exit(0)
  })
}

run().catch(error)
