import {test, expect} from "@playwright/test"

// Skip when using test relay - this test requires external relay.damus.io
const skipForTestRelay = process.env.VITE_USE_TEST_RELAY === "true"

test.skip("Subscribe with Negentropy to relay.damus.io", async ({page}) => {
  test.skip(skipForTestRelay, "Requires external relay.damus.io, not test relay")
  test.setTimeout(60000)

  const TEST_PUBKEY = "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0"
  const RELAY_URL = "wss://relay.damus.io"

  const negentropyLogs: string[] = []
  page.on("console", (msg) => {
    const text = msg.text()
    if (text.includes("negentropy") || text.includes("NEG-")) {
      console.log(`[Browser]: ${text}`)
      negentropyLogs.push(text)
    }
  })

  await page.addInitScript(() => {
    localStorage.setItem("debug", "ndk:negentropy,ndk:subscription")
  })

  await page.goto("/")
  await page.waitForLoadState("load")

  const result = await page.evaluate(
    async ({pubkey, relayUrl}) => {
      const NDK = (await import("/src/lib/ndk/index.js")).default

      try {
        const ndk = new NDK({
          explicitRelayUrls: [relayUrl],
          enableOutboxModel: false,
        })

        await ndk.connect()

        // Wait for relay to connect
        await new Promise((resolve) => setTimeout(resolve, 3000))

        const relay = Array.from(ndk.pool?.relays.values() || [])[0]
        if (!relay) {
          return {error: "Relay not found"}
        }

        if (!relay.connected) {
          return {error: "Relay not connected"}
        }

        // Check NIP-77 support
        await relay.fetchInfo()
        const supportsNeg = relay.supportsNip(77)
        if (!supportsNeg) {
          return {skipped: true, reason: "Relay does not support NIP-77"}
        }

        const receivedEventIds = new Set<string>()
        const protocolMessages: string[] = []
        const filter = {
          authors: [pubkey],
          limit: 50,
        }

        // Track NEG-* protocol messages
        const connectivity = relay.connectivity as {send: (msg: string) => unknown}
        const originalSend = connectivity.send
        connectivity.send = function (msg: string) {
          try {
            const parsed = JSON.parse(msg)
            if (parsed[0]?.startsWith("NEG-")) {
              protocolMessages.push(parsed[0])
            }
          } catch {
            // ignore parse errors
          }
          return originalSend.call(this, msg)
        }

        // Subscribe with Negentropy enabled
        const sub = ndk.subscribe(filter, {
          relayUrls: [relayUrl],
          useNegentropy: true,
          closeOnEose: false,
        })

        // Collect events for 10 seconds
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            sub.stop()
            resolve()
          }, 10000)

          sub.on("event", (event) => {
            if (event.id) {
              receivedEventIds.add(event.id)
            }
          })

          sub.on("close", () => {
            clearTimeout(timeout)
            resolve()
          })
        })

        return {
          success: true,
          eventCount: receivedEventIds.size,
          sampleIds: Array.from(receivedEventIds).slice(0, 3),
          protocolMessages,
        }
      } catch (error: unknown) {
        const err = error as {message: string; stack?: string}
        return {error: err.message, stack: err.stack}
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
  expect(result.eventCount).toBeLessThanOrEqual(50)

  for (const id of result.sampleIds || []) {
    expect(id).toMatch(/^[0-9a-f]{64}$/)
  }

  // Verify Negentropy protocol was actually used
  expect(result.protocolMessages).toContain("NEG-OPEN")
  expect(result.protocolMessages.length).toBeGreaterThan(0)

  const usedNegentropy = negentropyLogs.some(
    (log) => log.includes("NEG-OPEN") || log.includes("Sending NEG-OPEN")
  )
  expect(usedNegentropy).toBe(true)

  const syncCompleted = negentropyLogs.some((log) => log.includes("Sync complete"))
  expect(syncCompleted).toBe(true)

  console.log(
    `✓ Negentropy subscribe: ${result.eventCount} events via NIP-77 (${result.protocolMessages.join(", ")})`
  )
})

test.skip("Subscribe with Negentropy receives both historical and new events", async ({
  page,
}) => {
  test.setTimeout(60000)

  const TEST_PUBKEY = "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0"
  const RELAY_URL = "wss://relay.damus.io"

  await page.goto("/")
  await page.waitForLoadState("load")

  const result = await page.evaluate(
    async ({pubkey, relayUrl}) => {
      const NDK = (await import("/src/lib/ndk/index.js")).default

      try {
        const ndk = new NDK({
          explicitRelayUrls: [relayUrl],
          enableOutboxModel: false,
        })

        await ndk.connect()

        const relay = ndk.pool?.relays.get(relayUrl)
        if (!relay) {
          return {error: "Relay not found"}
        }

        await relay.fetchInfo()
        if (!relay.supportsNip(77)) {
          return {skipped: true}
        }

        const historicalEvents = new Set<string>()
        const newEvents = new Set<string>()
        const now = Math.floor(Date.now() / 1000)

        const filter = {
          authors: [pubkey],
          limit: 30,
        }

        const sub = ndk.subscribe(filter, {
          relayUrls: [relayUrl],
          useNegentropy: true,
        })

        // Track when events arrive
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            sub.stop()
            resolve()
          }, 15000)

          sub.on("event", (event) => {
            if (!event.id || !event.created_at) return

            // Categorize as historical or new based on timestamp
            if (event.created_at < now) {
              historicalEvents.add(event.id)
            } else {
              newEvents.add(event.id)
            }
          })

          sub.on("close", () => {
            clearTimeout(timeout)
            resolve()
          })
        })

        return {
          historicalCount: historicalEvents.size,
          newCount: newEvents.size,
          totalCount: historicalEvents.size + newEvents.size,
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

  // Should have received historical events via Negentropy
  expect(result.historicalCount).toBeGreaterThan(0)
  // May or may not have new events depending on timing
  expect(result.totalCount).toBeGreaterThan(0)

  console.log(
    `✓ Subscribe with Negentropy: ${result.historicalCount} historical, ${result.newCount} new (${result.totalCount} total)`
  )
})
