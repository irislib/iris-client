import type {Page} from "@playwright/test"
import {toHex} from "@hashtree/core"
import {createNamedGraphFixture} from "nostr-social-graph/testing/namedGraph"
import type {Event, Filter} from "nostr-tools"
import discovery from "../../src/assets/socialGraph.json" with {type: "json"}

const publisher = "npub1yscmnnadrmvape0mvgzfx9uyl267klnhzy8znsr6ysl8wtxngpqsnx6dm0"
const pointers = new WeakMap<Page, Event>()

export function isSnapshotRequest(filter: Filter) {
  return filter.kinds?.includes(30064) && filter["#d"]?.includes("social-graph")
}

export function snapshotPointer(page: Page, filters: Filter[]) {
  const event = pointers.get(page)
  return filters.some(
    (f) => isSnapshotRequest(f) && event && f.authors?.includes(event.pubkey)
  )
    ? event
    : undefined
}

/** Only the authority in the browser fixture's SDK is substituted. The real client
 * still checks its signature, resolves the CHK directory and verifies file digests. */
export async function signedGraphFixture(
  page: Page,
  mobile: Buffer,
  options: {holdMobile?: Promise<void>} = {}
) {
  const fixture = await createNamedGraphFixture(discovery.root, mobile)
  pointers.set(page, fixture.event)
  await page.route(
    /\/(?:assets\/vendor-[^/]+\.js|node_modules\/\.vite\/deps\/nostr-social-graph[^/]*\.js)(?:\?.*)?$/,
    async (route) => {
      const response = await route.fetch()
      const source = await response.text()
      await route.fulfill({
        response,
        body: source.replaceAll(publisher, fixture.publisher),
      })
    }
  )
  const fileHash = (name: string) =>
    toHex(fixture.uploaded.find((entry) => entry.name === name)!.cid.hash)
  const mobileHash = fileHash(fixture.manifest.mobile_roots[discovery.root].file)
  const fullHash = fileHash("social-graph-v4.bin")
  const reads: string[] = []
  await page.route(/^https:\/\/cdn\.iris\.to\/[a-f0-9]{64}\.bin$/, async (route) => {
    const hash = new URL(route.request().url()).pathname.slice(1, -4)
    const bytes = await fixture.readBlock(hash)
    if (!bytes) return route.fallback()
    reads.push(hash)
    if (hash === mobileHash) await options.holdMobile
    await route.fulfill({
      body: Buffer.from(bytes),
      contentType: "application/octet-stream",
    })
  })
  return {
    reads,
    mobileHash,
    fullHash,
    full: fixture.manifest.files["social-graph-v4.bin"],
    get mobileReads() {
      return reads.filter((s) => s === mobileHash).length
    },
  }
}

/** A missing signed graph name makes the ordinary loader use its pinned bundle. */
export async function useBundledGraphFallback(page: Page) {
  await page.addInitScript(() => {
    const send = WebSocket.prototype.send
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string" && data.startsWith('["REQ"')) {
        const [type, id, ...filters] = JSON.parse(data)
        if (
          type === "REQ" &&
          filters.some(
            (f) => f.kinds?.includes(30064) && f["#d"]?.includes("social-graph")
          )
        ) {
          queueMicrotask(() =>
            this.dispatchEvent(
              new MessageEvent("message", {data: JSON.stringify(["EOSE", id])})
            )
          )
          return
        }
      }
      send.call(this, data)
    }
  })
}
