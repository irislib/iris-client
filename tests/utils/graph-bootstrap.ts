import type {Page} from "@playwright/test"
import {createNamedGraphFixture} from "nostr-social-graph/testing/namedGraph"
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  type Event,
  type Filter,
} from "nostr-tools"
import {HashTree, MemoryStore, LinkType, sha256, toHex, fromHex} from "@hashtree/core"
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

// Negative parser cases still carry a valid signed name, CHK directory and
// matching digest. The malformed data must be rejected by the real loader.
async function rawSignedFixture(bytes: Buffer) {
  const key = generateSecretKey(),
    pubkey = getPublicKey(key),
    store = new MemoryStore()
  const tree = new HashTree({store, encryptionMode: "legacy-chk"})
  const encode = (text: string) => new TextEncoder().encode(text)
  const files = {
    "social-graph.bin": bytes,
    "social-graph-v4.bin": bytes,
    "mobile.bin": bytes,
    "profile-data.json": encode("[]"),
    "profile-index.json": encode('{"keys":[],"records":[]}'),
    "allowlist.txt": encode(discovery.root + "\n"),
  }
  const metadata = async (body: Uint8Array) => ({
    size: body.length,
    sha256: toHex(await sha256(body)),
  })
  const alternate = "mobile-" + discovery.root + ".bin",
    now = Math.floor(Date.now() / 1000)
  const manifest = {
    version: 1,
    root: pubkey,
    graph_completed_at: now,
    graph_since: now - 300,
    generated_at: now,
    files: Object.fromEntries(
      await Promise.all(
        Object.entries(files).map(async ([name, body]) => [name, await metadata(body)])
      )
    ),
    mobile_roots: {[discovery.root]: {file: alternate, ...(await metadata(bytes))}},
  }
  const uploaded = await Promise.all(
    Object.entries({
      ...files,
      [alternate]: bytes,
      "manifest.json": encode(JSON.stringify(manifest)),
    }).map(async ([name, body]) => {
      const file = await tree.putFile(body)
      return {...file, name, hash: toHex(file.cid.hash), type: LinkType.File}
    })
  )
  const {cid} = await tree.putDirectory(uploaded)
  return {
    publisher: nip19.npubEncode(pubkey),
    manifest,
    uploaded,
    event: finalizeEvent(
      {
        kind: 30064,
        created_at: now,
        tags: [
          ["d", "social-graph"],
          ["l", "hashtree"],
          ["hash", toHex(cid.hash)],
          ["key", toHex(cid.key!)],
        ],
        content: "",
      },
      key
    ),
    readBlock: (hash: string) => store.get(fromHex(hash)),
  }
}

export function duplicateGraphIdentity(bytes: Buffer) {
  const result = Buffer.from(bytes)
  let offset = 0
  const variable = () => {
    let value = 0,
      shift = 0,
      byte: number
    do {
      byte = result[offset++]
      value += (byte & 127) * 2 ** shift
      shift += 7
    } while (byte & 128)
    return value
  }
  if (variable() !== 4 || variable() < 2) throw new Error("Expected v4 identities")
  variable()
  if (variable() !== 0) throw new Error("Expected public key")
  const first = result.subarray(offset, offset + 32)
  offset += 32
  variable()
  if (variable() !== 0) throw new Error("Expected public key")
  result.set(first, offset)
  return result
}

/** Only the authority in the browser fixture's SDK is substituted. The real client
 * still checks its signature, resolves the CHK directory and verifies file digests. */
export async function signedGraphFixture(
  page: Page,
  mobile: Buffer,
  options: {
    holdMobile?: Promise<void>
    failure?: "malformed" | "integrity" | "unavailable"
  } = {}
) {
  const fixture =
    options.failure === "malformed"
      ? await rawSignedFixture(mobile)
      : await createNamedGraphFixture(discovery.root, mobile)
  pointers.set(page, fixture.event)
  await page.route(
    /\/(?:assets\/vendor-[^/]+\.js|node_modules\/\.vite\/deps\/(?:nostr-social-graph[^/]*|chunk-[^/]+)\.js)(?:\?.*)?$/,
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
    fixture.uploaded.find((entry) => entry.name === name)!.hash
  const mobileHash = fileHash(fixture.manifest.mobile_roots[discovery.root].file)
  const fullHash = fileHash("social-graph-v4.bin")
  const reads: string[] = []
  await page.route(/^https:\/\/cdn\.iris\.to\/[a-f0-9]{64}\.bin$/, async (route) => {
    const hash = new URL(route.request().url()).pathname.slice(1, -4)
    const bytes = await fixture.readBlock(hash)
    if (!bytes) return route.fallback()
    reads.push(hash)
    if (hash === mobileHash) {
      await options.holdMobile
      if (options.failure === "unavailable") return route.abort()
    }
    const body = Buffer.from(bytes)
    if (options.failure === "integrity" && hash === mobileHash) body[0] ^= 1
    await route.fulfill({
      body,
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
