import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent} from "nostr-tools/pure"
import {ReconciliationRelayFixture} from "./fixtures/reconciliationRelay"
import {usingBuiltDist} from "./utils/built-dist"

test.skip(usingBuiltDist, "the worker integration harness imports source modules")

type Probe = {ids: string[]; cached: string[]; close(): void; readCache(id: string): void}
const ids = (page: Page) =>
  page.evaluate(() => (window as Window & {relayProbe: Probe}).relayProbe.ids)

for (const supported of [true, false]) {
  test(`relay worker preserves immediate history and live events with NIP-77 supported=${supported}`, async ({
    page,
  }) => {
    const relay = new ReconciliationRelayFixture()
    relay.supported = supported
    const now = Math.floor(Date.now() / 1000)
    const secret = new Uint8Array(32).fill(53)
    const note = (content: string, kind = 1, tags: string[][] = []) =>
      finalizeEvent({kind, tags, content, created_at: now - 10}, secret)
    const ordinary = note("ordinary"),
      gap = note("recovered gap"),
      removed = note("removed")
    const invalid = {...note("invalid"), sig: "0".repeat(128)}
    const deletion = finalizeEvent(
      {kind: 5, tags: [["e", removed.id]], content: "", created_at: now - 5},
      secret
    )
    relay.ordinaryEvents.push(ordinary, deletion)
    relay.events.push(ordinary, deletion, gap, removed, invalid)
    try {
      await page.route("**/__relay-test", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<html><body>Relay worker test</body></html>",
        })
      )
      await page.goto("/__relay-test")
      await page.evaluate(
        async ({url, author}) => {
          // The minimal page needs the same configuration bootstrap as Vite's HTML.
          const environmentPath = "/@vite/env"
          await import(environmentPath)
          const transportPath = "/src/lib/nostr-transport-worker.ts"
          const clientPath = "/src/lib/nostr/index.ts"
          const workerPath = "/src/workers/relay-worker.ts?worker"
          const [{WorkerTransport}, {NostrClient}, {default: RelayWorker}] =
            await Promise.all([
              import(transportPath),
              import(clientPath),
              import(workerPath),
            ])
          const transport = new WorkerTransport(() => new RelayWorker())
          const probe: Probe = {
            ids: [],
            cached: [],
            close: () => transport.close(),
            readCache: (id) =>
              transport.subscribe(
                "cache-proof",
                [{ids: [id]}],
                (event: {id: string}) => probe.cached.push(event.id),
                undefined,
                {cacheUsage: "cache-only"}
              ),
          }
          Object.assign(window, {relayProbe: probe})
          await transport.connect(new NostrClient(), [url], {disableExtraRelayUrls: true})
          transport.subscribe(
            "gap-proof",
            [{authors: [author], kinds: [1, 5], limit: 2}],
            (event: {id: string}) => probe.ids.push(event.id),
            undefined,
            {closeOnEose: false}
          )
        },
        {url: await relay.url(), author: ordinary.pubkey}
      )
      await expect.poll(() => ids(page)).toContain(ordinary.id)
      await expect.poll(() => relay.metadataRequests).toBe(1)
      expect((await ids(page)).includes(gap.id)).toBe(false)
      expect(relay.frames[0]?.[0]).toBe("REQ")
      if (supported) {
        await expect
          .poll(() => relay.frames.filter((frame) => frame[0] === "NEG-OPEN").length)
          .toBe(1)
        relay.release()
        await expect.poll(() => ids(page)).toContain(gap.id)
        expect(await ids(page)).not.toContain(removed.id)
        expect(await ids(page)).not.toContain(invalid.id)
        const requests = relay.frames.filter((frame) => frame[0] === "REQ").length
        await page.evaluate(
          (id) => (window as Window & {relayProbe: Probe}).relayProbe.readCache(id),
          gap.id
        )
        await expect
          .poll(() =>
            page.evaluate(
              () => (window as Window & {relayProbe: Probe}).relayProbe.cached
            )
          )
          .toEqual([gap.id])
        expect(relay.frames.filter((frame) => frame[0] === "REQ")).toHaveLength(requests)
      } else {
        expect(relay.frames.some((frame) => frame[0] === "NEG-OPEN")).toBe(false)
      }
      const live = note("live after reconciliation")
      relay.emit(live)
      await expect.poll(() => ids(page)).toContain(live.id)
      expect(relay.clients.size).toBe(1)
      await page.evaluate(() =>
        (window as Window & {relayProbe: Probe}).relayProbe.close()
      )
    } finally {
      await page.close()
      await relay.close()
    }
  })
}
