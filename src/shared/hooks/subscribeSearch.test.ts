import {afterEach, expect, it, vi} from "vitest"
import NostrClient, {AppEvent, Relay} from "@/lib/nostr"
import {subscribeSearch} from "./subscribeSearch"

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it("uses completed word indexes and resumes only the interrupted fallback", async () => {
  vi.useFakeTimers()
  const nostr = new NostrClient()
  const relay = new Relay("wss://search.example", undefined, nostr)
  const onProgress = vi.fn()
  const requests: (string | undefined)[] = []
  const boundaries = new Map([
    ["iris", 100],
    ["marketplace", 900],
    ["iris marketplace", 10],
  ])
  nostr.transportPlugins.push({
    name: "worker-transport",
    onSubscribe(subscription, filters) {
      const term = filters[0].search
      requests.push(term)
      if (!term) return // A slow ordinary relay must not hold back text results.
      const timer = setTimeout(() => {
        subscription.eventReceived(
          new AppEvent(nostr, {
            id: term,
            pubkey: "a".repeat(64),
            kind: 1,
            created_at: boundaries.get(term)!,
            content: term,
            tags: [],
          }),
          relay
        )
        subscription.eoseReceived(null)
      }, 50)
      subscription.once("close", () => clearTimeout(timer))
    },
  })
  const filters = [undefined, "iris marketplace", "iris", "marketplace"].map(
    (search) => ({
      kinds: [1],
      search,
      until: 1000,
    })
  )
  const session = {}
  const start = () =>
    subscribeSearch(nostr, filters, vi.fn(), () => false, onProgress, undefined, session)
  const search = start()
  await vi.advanceTimersByTimeAsync(100)
  // Every match must contain "iris", so that term alone covers this interval.
  // The phrase index can omit words in another order and cannot set the boundary.
  expect(onProgress).toHaveBeenLastCalledWith({
    loading: true,
    canLoadMore: false,
    oldestSearched: 100,
  })
  search.stop()
  requests.length = 0
  const resumed = start()
  await vi.advanceTimersByTimeAsync(100)
  expect(requests).toEqual([undefined])
  resumed.stop()
})

it("waits for indexed results instead of ordinary relay completion", async () => {
  vi.useFakeTimers()
  const nostr = new NostrClient()
  // Search must stay in the worker and never create a second relay runtime.
  const ordinaryStart = vi.spyOn(nostr, "getRuntime").mockImplementation(() => {
    throw new Error("Unexpected main-thread relay runtime")
  })
  const relay = new Relay("wss://search.example", undefined, nostr)
  const event = new AppEvent(nostr, {
    id: "matching-note",
    pubkey: "a".repeat(64),
    kind: 1,
    created_at: 900,
    content: "marketplace for iris",
    tags: [],
  })
  nostr.transportPlugins.push({
    name: "worker-transport",
    onSubscribe(subscription) {
      const timer = setTimeout(() => {
        subscription.eventReceived(event, relay)
        subscription.eoseReceived(null)
      }, 50)
      subscription.once("close", () => clearTimeout(timer))
    },
  })
  const onEvent = vi.fn()
  const onProgress = vi.fn()
  const search = subscribeSearch(
    nostr,
    [{kinds: [1], search: "iris marketplace", until: 1000}],
    onEvent,
    () => false,
    onProgress
  )
  await vi.advanceTimersByTimeAsync(100)
  expect(ordinaryStart).not.toHaveBeenCalled()
  expect(onEvent).toHaveBeenCalledWith(event)
  expect(onProgress).toHaveBeenLastCalledWith({
    loading: false,
    canLoadMore: true,
    oldestSearched: 900,
  })
  search.stop()
})

it.each([false, true])(
  "keeps a slow index open and explicitly retries its original interval (partial: %s)",
  async (partial) => {
    vi.useFakeTimers()
    const nostr = new NostrClient()
    const relay = new Relay("wss://search.example", undefined, nostr)
    const textRequests: number[] = []
    const onProgress = vi.fn()
    const onEvent = vi.fn()
    let deliverLate = () => {}
    nostr.transportPlugins.push({
      name: "worker-transport",
      onSubscribe(subscription, filters) {
        const filter = filters[0]
        if (filter.search) textRequests.push(filter.until!)
        // The first text request is slow; the old tag index works.
        if (filter.search && textRequests.length === 1) {
          deliverLate = () =>
            subscription.eventReceived(
              new AppEvent(nostr, {
                id: "late-match",
                pubkey: "d".repeat(64),
                kind: 1,
                created_at: 925,
                content: "iris",
                tags: [],
              }),
              relay
            )
          if (partial) {
            setTimeout(() => {
              subscription.eventReceived(
                new AppEvent(nostr, {
                  id: "partial-match",
                  pubkey: "c".repeat(64),
                  kind: 1,
                  created_at: 950,
                  content: "iris",
                  tags: [],
                }),
                relay
              )
            }, 50)
          }
          return
        }
        const timer = setTimeout(() => {
          const event = new AppEvent(nostr, {
            id: filter.search ? "recent-match" : "old-tag-match",
            pubkey: (filter.search ? "a" : "b").repeat(64),
            kind: 1,
            created_at: filter.search ? 900 : 100,
            content: "iris",
            tags: [["t", "iris"]],
          })
          subscription.eventReceived(event, relay)
          subscription.eoseReceived(null)
        }, 50)
        subscription.once("close", () => clearTimeout(timer))
      },
    })
    const search = subscribeSearch(
      nostr,
      [
        {kinds: [1], search: "iris", until: 1000},
        {kinds: [1], "#t": ["iris"], until: 1000},
      ],
      onEvent,
      () => !onEvent.mock.calls.some(([event]) => event.id === "recent-match"),
      onProgress
    )
    await vi.advanceTimersByTimeAsync(16_000)
    expect(textRequests).toEqual([1000])
    search.loadMore(false)
    await vi.advanceTimersByTimeAsync(100)
    expect(textRequests).toEqual([1000])
    deliverLate()
    expect(onEvent.mock.calls.some(([event]) => event.id === "late-match")).toBe(true)
    search.loadMore()
    await vi.advanceTimersByTimeAsync(100)
    expect(textRequests).toEqual([1000, 1000])
    expect(
      onProgress.mock.calls.find(([state]) => state.oldestSearched !== undefined)?.[0]
        .oldestSearched
    ).toBe(1000)
    expect(onProgress.mock.calls.map(([state]) => state.oldestSearched)).not.toContain(0)
    expect(onEvent.mock.calls.some(([event]) => event.id === "recent-match")).toBe(true)
    expect(onProgress).toHaveBeenLastCalledWith({
      loading: false,
      canLoadMore: true,
      oldestSearched: 900,
    })
    search.stop()
  }
)

it("continues completed relay history while retaining the interrupted page for retry", async () => {
  vi.useFakeTimers()
  const nostr = new NostrClient()
  const archive = new Relay("wss://archive.example/", undefined, nostr)
  const offline = new Relay("wss://offline.example/", undefined, nostr)
  const onEvent = vi.fn()
  const requests: {relays?: string[]; until?: number}[] = []
  nostr.transportPlugins.push({
    name: "worker-transport",
    onSubscribe(sub, [filter], opts) {
      const relays = opts?.relayUrls
      requests.push({relays, until: filter.until})
      const scoped = relays?.includes(archive.url)
      const recovered = !scoped && requests.length > 1
      const relay = recovered ? offline : archive
      const event = new AppEvent(nostr, {
        id: scoped ? "older" : relay.url,
        kind: 1,
        pubkey: "a".repeat(64),
        created_at: scoped ? 700 : 900,
        content: "photo",
        tags: [],
      })
      sub.eventReceived(event, relay)
      sub.eoseReceived(null, {
        complete: !!scoped || recovered,
        reason: scoped || recovered ? "eose" : "timeout",
        sources: scoped
          ? [{id: archive.url, complete: true}]
          : [
              {id: archive.url, complete: true},
              {id: offline.url, complete: recovered},
            ],
      })
    },
  })
  const history = subscribeSearch(
    nostr,
    [{kinds: [1], until: 1000}],
    onEvent,
    () => !onEvent.mock.calls.some(([e]) => e.id === "older"),
    vi.fn()
  )
  await vi.advanceTimersByTimeAsync(1)
  expect(requests).toEqual([
    {relays: undefined, until: 1000},
    {relays: [archive.url], until: 900},
  ])
  expect(onEvent.mock.calls.map(([e]) => e.id)).toEqual([archive.url, "older"])
  history.loadMore()
  await vi.advanceTimersByTimeAsync(1)
  expect(requests.slice(2)).toContainEqual({relays: undefined, until: 1000})
  expect(onEvent.mock.calls.some(([e]) => e.id === offline.url)).toBe(true)
  history.stop()
})
