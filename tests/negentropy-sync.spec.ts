import {test, expect} from "@playwright/test"

/**
 * Negentropy sync integration tests
 *
 * These tests verify NIP-77 Negentropy protocol implementation against live relays.
 * Tests are skipped by default. To run:
 * 1. Remove .skip from test declarations
 * 2. Run: VITE_USE_TEST_RELAY=false npx playwright test tests/negentropy-sync.spec.ts --reporter=list
 *
 * Note: Relay must be connected before starting sync. Tests use relay.damus.io which supports NIP-77.
 */

test.skip("Negentropy sync with relay", async ({page}) => {
  test.setTimeout(60000)

  const TEST_PUBKEY = "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0"
  // strfry relay with NIP-77 support
  const RELAY_URL = "wss://relay.damus.io"

  // Enable debug logging
  page.on("console", (msg) => {
    const text = msg.text()
    if (text.includes("negentropy") || text.includes("NEG-")) {
      console.log(`[Browser]: ${text}`)
    }
  })

  await page.addInitScript(() => {
    localStorage.setItem("debug", "ndk:negentropy")
  })

  await page.goto("/")
  await page.waitForLoadState("load")

  // Run test in browser context where IndexedDB is available
  const result = await page.evaluate(
    async ({pubkey, relayUrl}) => {
      const {NDKRelay} = await import("/src/lib/ndk/index.js")
      const {buildStorageVector, negentropySync} =
        await import("/src/lib/ndk/negentropy/index.js")

      try {
        // Connect to relay
        const relay = new NDKRelay(relayUrl, undefined, {} as Record<string, unknown>)
        await relay.connect(10000)

        // Check NIP-77 support
        const info = await relay.fetchInfo()
        console.log("Relay info:", {
          name: info.name,
          supported_nips: info.supported_nips,
        })

        const supportsNeg = relay.supportsNip(77)
        if (!supportsNeg) {
          return {
            skipped: true,
            reason: "Relay does not support NIP-77",
          }
        }

        // Perform sync with empty storage
        const storage = buildStorageVector([])
        const receivedEventIds = new Set<string>()
        const filter = {
          authors: [pubkey],
          limit: 100,
        }

        const success = await negentropySync(
          storage,
          relay,
          filter,
          async (have, need) => {
            console.log(`negentropy reconcile: have=${have.length}, need=${need.length}`)

            if (have.length > 0) {
              return {
                error: `Expected empty storage to have 0 events, got ${have.length}`,
              }
            }

            for (const id of need) {
              receivedEventIds.add(id)
            }
          }
        )

        relay.disconnect()

        return {
          success,
          eventCount: receivedEventIds.size,
          eventIds: Array.from(receivedEventIds).slice(0, 5), // Sample
        }
      } catch (error: unknown) {
        const err = error as {message: string; stack?: string}
        return {
          error: err.message,
          stack: err.stack,
        }
      }
    },
    {pubkey: TEST_PUBKEY, relayUrl: RELAY_URL}
  )

  console.log("Test result:", result)

  if ("skipped" in result && result.skipped) {
    console.log(`Test skipped: ${result.reason}`)
    test.skip()
    return
  }

  if ("error" in result && result.error) {
    throw new Error(`Test failed: ${result.error}`)
  }

  expect(result.success).toBe(true)
  expect(result.eventCount).toBeGreaterThan(0)
  expect(result.eventCount).toBeLessThanOrEqual(100)

  // Verify event ID format
  for (const id of result.eventIds || []) {
    expect(id).toMatch(/^[0-9a-f]{64}$/)
  }

  console.log(`✓ Negentropy sync successful: ${result.eventCount} events identified`)
})

test.skip("Negentropy incremental sync", async ({page}) => {
  test.setTimeout(60000)

  const TEST_PUBKEY = "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0"
  const RELAY_URL = "wss://relay.damus.io"

  await page.goto("/")
  await page.waitForLoadState("load")

  const result = await page.evaluate(
    async ({pubkey, relayUrl}) => {
      const {NDKRelay} = await import("/src/lib/ndk/index.js")
      const {buildStorageVector, negentropySync} =
        await import("/src/lib/ndk/negentropy/index.js")

      try {
        const relay = new NDKRelay(relayUrl, undefined, {} as Record<string, unknown>)
        await relay.connect(10000)

        const supportsNeg = relay.supportsNip(77)
        if (!supportsNeg) {
          return {skipped: true}
        }

        const filter = {
          authors: [pubkey],
          limit: 50,
        }

        // First sync
        const firstSyncIds: string[] = []
        const storage1 = buildStorageVector([])

        await negentropySync(storage1, relay, filter, async (_have, need) => {
          firstSyncIds.push(...need)
        })

        console.log(`First sync: ${firstSyncIds.length} events`)

        // Build storage from first sync (with fake timestamps)
        const mockEvents = firstSyncIds.map((id) => ({
          id,
          created_at: 1000000,
        })) as Array<{id: string; created_at: number}>

        const storage2 = buildStorageVector(mockEvents)
        let totalDiff = 0

        // Second sync - should find minimal differences
        await negentropySync(storage2, relay, filter, async (have, need) => {
          console.log(`Second sync: have=${have.length}, need=${need.length}`)
          totalDiff = have.length + need.length
        })

        relay.disconnect()

        return {
          firstSyncCount: firstSyncIds.length,
          secondSyncDiff: totalDiff,
        }
      } catch (error: unknown) {
        const err = error as {message: string}
        return {error: err.message}
      }
    },
    {pubkey: TEST_PUBKEY, relayUrl: RELAY_URL}
  )

  if ("skipped" in result && result.skipped) {
    test.skip()
    return
  }

  if ("error" in result && result.error) {
    throw new Error(`Test failed: ${result.error}`)
  }

  expect(result.firstSyncCount).toBeGreaterThan(0)
  // Second sync should have minimal diff (allowing for new events)
  expect(result.secondSyncDiff).toBeLessThan(5)

  console.log(
    `✓ Incremental sync: first=${result.firstSyncCount}, diff=${result.secondSyncDiff}`
  )
})

test.skip("Negentropy with frame size limit", async ({page}) => {
  test.setTimeout(60000)

  const TEST_PUBKEY = "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0"
  const RELAY_URL = "wss://relay.damus.io"

  await page.goto("/")
  await page.waitForLoadState("load")

  const result = await page.evaluate(
    async ({pubkey, relayUrl}) => {
      const {NDKRelay} = await import("/src/lib/ndk/index.js")
      const {buildStorageVector, negentropySync} =
        await import("/src/lib/ndk/negentropy/index.js")

      try {
        const relay = new NDKRelay(relayUrl, undefined, {} as Record<string, unknown>)
        await relay.connect(10000)

        const supportsNeg = relay.supportsNip(77)
        if (!supportsNeg) {
          return {skipped: true}
        }

        const storage = buildStorageVector([])
        const receivedEventIds: string[] = []
        const filter = {
          authors: [pubkey],
          limit: 100,
        }

        // Small frame size to force multiple rounds
        const success = await negentropySync(
          storage,
          relay,
          filter,
          async (_have, need) => {
            receivedEventIds.push(...need)
          },
          {frameSizeLimit: 10000}
        )

        relay.disconnect()

        return {
          success,
          eventCount: receivedEventIds.length,
        }
      } catch (error: unknown) {
        const err = error as {message: string}
        return {error: err.message}
      }
    },
    {pubkey: TEST_PUBKEY, relayUrl: RELAY_URL}
  )

  if ("skipped" in result && result.skipped) {
    test.skip()
    return
  }

  if ("error" in result && result.error) {
    throw new Error(`Test failed: ${result.error}`)
  }

  expect(result.success).toBe(true)
  expect(result.eventCount).toBeGreaterThan(0)

  console.log(`✓ Frame size limit test: ${result.eventCount} events`)
})
