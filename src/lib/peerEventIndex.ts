import {
  BlossomStore,
  FallbackStore,
  nhashDecode,
  toHex,
  type CID,
  type Store,
} from "@hashtree/core"
import {nip19} from "nostr-tools"
import {isPrivateRelayEvent, type NostrEventReader} from "nostr-pubsub"
import type {AppEvent, NostrClient} from "./nostr"
import {localBlocks} from "./fileStore"
import {getPeerRuntime} from "./peerRuntime"
import {HASHTREE_ROOT_KINDS, parseHashtreeRootEvent} from "@hashtree/nostr"

// Iris Social's public archive. A deployment can also select a published fork or an immutable nhash.
const DEFAULT_EVENT_INDEX =
  "npub1yscmnnadrmvape0mvgzfx9uyl267klnhzy8znsr6ysl8wtxngpqsnx6dm0/nostr-event-index"
const MAX_INDEX_EVENTS = 100

export function openBrowsingIndex(
  client: () => NostrClient,
  lifetime: AbortSignal
): NostrEventReader {
  const reference =
    (import.meta.env.VITE_E2E ? window.__IRIS_FIPS_TEST_CONFIG__?.indexRef : undefined) ??
    import.meta.env.VITE_NOSTR_EVENT_INDEX ??
    DEFAULT_EVENT_INDEX
  let waiting: Promise<boolean> | undefined
  async function fetchPeerBlock(hash: Uint8Array) {
    const runtime = await getPeerRuntime()
    if (!runtime || lifetime.aborted) return null
    const {provider} = runtime
    // A cold link can request its root before WebRTC discovery has a file route.
    // Share one bounded wait for the next usable neighbor across simultaneous block reads.
    if (!(await provider.listPeerIds()).length) {
      waiting ??= new Promise<boolean>((resolve) => {
        const finish = (available: boolean) => {
          unsubscribe()
          clearTimeout(timer)
          lifetime.removeEventListener("abort", stop)
          resolve(available)
        }
        const stop = () => finish(false)
        const check = () => {
          void Promise.resolve(provider.listPeerIds()).then((ids) => {
            if (ids.length) finish(true)
          }, stop)
        }
        const unsubscribe = provider.node.on("peer", check)
        const timer = setTimeout(stop, 4500)
        lifetime.addEventListener("abort", stop, {once: true})
        check()
      }).finally(() => {
        waiting = undefined
      })
      if (!(await waiting)) return null
    }
    return provider.fetch(toHex(hash))
  }
  const store = new FallbackStore({
    primary: localBlocks,
    timeout: 7500,
    fallbacks: [
      {get: fetchPeerBlock},
      new BlossomStore({
        servers: [{url: "https://cdn.iris.to", read: true, write: false}],
      }),
    ],
  })
  return createPeerEventIndex(store, reference.trim(), client, lifetime)
}

function createPeerEventIndex(
  store: Store,
  reference: string,
  client: () => NostrClient,
  lifetime: AbortSignal
): NostrEventReader {
  let root: CID | undefined
  let started = false
  const ready = new EventTarget()
  let settled = false
  const settle = () => {
    settled = true
    ready.dispatchEvent(new Event("ready"))
  }

  function watchRoot() {
    if (reference.startsWith("nhash1")) {
      root = nhashDecode(reference)
      settle()
      return
    }
    const [author, name, ...rest] = reference.split("/")
    const decoded = nip19.decode(author)
    if (decoded.type !== "npub" || !name || rest.length)
      throw new Error("Invalid Nostr event index")
    // A fixed catalog lookup, routed through relay discovery, independent of the note being viewed.
    const nostr = client()
    const sub = nostr.subscribe(
      {kinds: [...HASHTREE_ROOT_KINDS], authors: [decoded.data], "#d": [name]},
      {relayUrls: nostr.explicitRelayUrls}
    )
    let current: {id: string; created_at: number} | undefined
    sub.on("event", (event: AppEvent) => {
      const raw = event.rawEvent()
      if (
        raw.pubkey !== decoded.data ||
        raw.tags.filter((tag) => tag[0] === "d").length !== 1
      )
        return
      const next = parseHashtreeRootEvent(raw)
      if (!next || next.visibility !== "public" || next.treeName !== name) return
      if (
        !current ||
        raw.created_at > current.created_at ||
        (raw.created_at === current.created_at && raw.id < current.id)
      ) {
        current = {id: raw.id, created_at: raw.created_at}
        root = next.rootCid
        if (!settled) settle()
      }
    })
    sub.once("eose", settle)
    lifetime.addEventListener("abort", () => sub.stop(), {once: true})
  }
  return {
    async query(filters, options = {}) {
      const supported = filters.filter(
        (filter) =>
          filter.search === undefined &&
          !filter.kinds?.some((kind) => isPrivateRelayEvent({kind}))
      )
      if (!supported.length || !reference) return {events: [], complete: true}
      const timeout = Math.max(0, (options.deadline ?? Date.now() + 10000) - Date.now())
      if (!timeout) return {events: [], complete: false}
      const signal = AbortSignal.any([
        lifetime,
        ...(options.signal ? [options.signal] : []),
        AbortSignal.timeout(timeout),
      ])
      signal.throwIfAborted()
      if (!started) {
        watchRoot()
        started = true
      }
      if (!settled)
        await new Promise<void>((resolve) => {
          const finish = () => {
            ready.removeEventListener("ready", finish)
            signal.removeEventListener("abort", finish)
            resolve()
          }
          signal.addEventListener("abort", finish, {once: true})
          ready.addEventListener("ready", finish, {once: true})
        })
      signal.throwIfAborted()
      if (!root) return {events: [], complete: false}
      const {HashtreeNostrEventReader} = await import("@hashtree/nostr-pubsub")
      const reader = new HashtreeNostrEventReader({store, roots: root})
      const limit = Math.min(options.limit ?? MAX_INDEX_EVENTS, MAX_INDEX_EVENTS)
      const result = await reader.query(supported, {...options, limit, signal})
      return {
        events: result.events,
        complete: result.complete && result.events.length < limit,
      }
    },
  }
}
