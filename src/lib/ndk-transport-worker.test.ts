import {describe, expect, it, vi} from "vitest"

import {NDKWorkerTransport} from "./ndk-transport-worker"
import type {WorkerMessage, WorkerResponse} from "./ndk-transport-types"
import type NDK from "./ndk"
import {useSettingsStore} from "@/stores/settings"

class FakeWorker {
  onerror: ((error: ErrorEvent) => void) | null = null
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  private listeners = new Map<
    string,
    Set<(event: MessageEvent<WorkerResponse>) => void>
  >()
  postedMessages: WorkerMessage[] = []

  addEventListener(
    type: string,
    listener: (event: MessageEvent<WorkerResponse>) => void
  ) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(listener)
  }

  removeEventListener(
    type: string,
    listener: (event: MessageEvent<WorkerResponse>) => void
  ) {
    this.listeners.get(type)?.delete(listener)
  }

  postMessage(message: WorkerMessage) {
    this.postedMessages.push(message)
  }

  dispatchMessage(data: WorkerResponse) {
    const event = {data} as MessageEvent<WorkerResponse>
    this.listeners.get("message")?.forEach((listener) => listener(event))
    this.onmessage?.(event)
  }

  terminate() {}
}

describe("NDKWorkerTransport search", () => {
  it("keeps partial search updates alive until the final search result arrives", async () => {
    const worker = new FakeWorker()
    const transport = new NDKWorkerTransport(() => worker as unknown as Worker)

    worker.dispatchMessage({type: "ready"})

    const updates: Array<Array<{item: {pubKey: string; name: string}; score?: number}>> =
      []
    const pending = transport.search("jack", (results) => {
      updates.push(
        results as Array<{item: {pubKey: string; name: string}; score?: number}>
      )
    })

    const request = worker.postedMessages.find(
      (message) => message.type === "search" && message.searchQuery === "jack"
    )

    expect(request?.searchRequestId).toBeDefined()

    worker.dispatchMessage({
      type: "searchResult",
      searchRequestId: request?.searchRequestId,
      searchResults: [
        {
          item: {pubKey: "pubkey-1", name: "jack fan"},
          score: 1,
        },
      ],
      searchComplete: false,
    })

    await Promise.resolve()

    expect(updates).toEqual([
      [
        {
          item: {pubKey: "pubkey-1", name: "jack fan"},
          score: 1,
        },
      ],
    ])

    worker.dispatchMessage({
      type: "searchResult",
      searchRequestId: request?.searchRequestId,
      searchResults: [
        {
          item: {pubKey: "pubkey-jack", name: "jack"},
          score: 2,
        },
      ],
      searchComplete: true,
    })

    await expect(pending).resolves.toEqual([
      {
        item: {pubKey: "pubkey-jack", name: "jack"},
        score: 2,
      },
    ])

    expect(updates).toEqual([
      [
        {
          item: {pubKey: "pubkey-1", name: "jack fan"},
          score: 1,
        },
      ],
      [
        {
          item: {pubKey: "pubkey-jack", name: "jack"},
          score: 2,
        },
      ],
    ])
  })
})

describe("NDKWorkerTransport lifecycle", () => {
  it("restores active subscriptions exactly once after a crash, including changes during recovery", async () => {
    vi.useFakeTimers()
    const workers: FakeWorker[] = []
    const transport = new NDKWorkerTransport(() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker as unknown as Worker
    })
    const ndk = {transportPlugins: []} as unknown as NDK
    const onEvent = vi.fn()
    const onEose = vi.fn()

    try {
      await transport.connect(ndk, ["wss://relay.example"])
      workers[0].dispatchMessage({type: "ready"})
      transport.subscribe("feed", [{kinds: [1]}], onEvent, onEose)
      transport.subscribe("closed", [{kinds: [7]}], vi.fn())
      const completed = vi.fn()
      transport.subscribeCacheOnly("completed", [{kinds: [0]}], vi.fn(), completed)
      workers[0].dispatchMessage({type: "eose", subId: "completed"})
      expect(completed).toHaveBeenCalledOnce()
      workers[0].onerror?.({message: "worker crashed"} as ErrorEvent)
      transport.unsubscribe("closed")
      transport.subscribeCacheOnly("cached", [{kinds: [0]}], vi.fn())
      workers[0].dispatchMessage({type: "ready"})
      expect(workers[0].postedMessages.some((message) => message.id === "cached")).toBe(
        false
      )
      await vi.advanceTimersByTimeAsync(1000)
      workers[1].dispatchMessage({type: "ready"})

      expect(
        workers[1].postedMessages.filter((message) => message.type === "subscribe")
      ).toMatchObject([
        {id: "feed", filters: [{kinds: [1]}]},
        {id: "cached", subscribeOpts: {destinations: ["cache"], closeOnEose: true}},
      ])
      workers[1].dispatchMessage({
        type: "event",
        subId: "feed",
        event: {
          id: "post",
          pubkey: "a".repeat(64),
          kind: 1,
          content: "recovered",
          tags: [],
        },
      })
      workers[1].dispatchMessage({type: "eose", subId: "feed"})
      expect(onEvent).toHaveBeenCalledOnce()
      expect(onEose).toHaveBeenCalledOnce()
    } finally {
      transport.close()
      vi.useRealTimers()
    }
  })

  it("coalesces repeated crash signals and cancels recovery when closed", async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const factory = vi.fn(() => worker as unknown as Worker)
    const transport = new NDKWorkerTransport(factory)
    try {
      await transport.connect({transportPlugins: []} as unknown as NDK, [])
      worker.onerror?.({message: "crash"} as ErrorEvent)
      worker.onerror?.({message: "same crash"} as ErrorEvent)
      await vi.advanceTimersByTimeAsync(1000)
      expect(factory).toHaveBeenCalledTimes(2)
      expect(
        worker.postedMessages.filter((message) => message.type === "init")
      ).toHaveLength(2)
      worker.dispatchMessage({type: "ready"})
      worker.onerror?.({message: "another crash"} as ErrorEvent)
      transport.close()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(factory).toHaveBeenCalledTimes(2)
    } finally {
      transport.close()
      vi.useRealTimers()
    }
  })

  it("dispatches a worker event before the following EOSE", async () => {
    const worker = new FakeWorker()
    const transport = new NDKWorkerTransport(() => worker as unknown as Worker)
    const ndk = {transportPlugins: []} as unknown as NDK
    const order: string[] = []

    try {
      await transport.connect(ndk, [])
      worker.dispatchMessage({type: "ready"})
      transport.subscribe(
        "ordered-subscription",
        [{kinds: [3]}],
        () => order.push("event"),
        () => order.push("eose")
      )

      worker.dispatchMessage({
        type: "event",
        subId: "ordered-subscription",
        event: {
          id: "event-id",
          pubkey: "a".repeat(64),
          created_at: 1,
          kind: 3,
          tags: [],
          content: "",
          sig: "signature",
        },
      })
      worker.dispatchMessage({type: "eose", subId: "ordered-subscription"})

      expect(order).toEqual(["event", "eose"])
    } finally {
      transport.close()
    }
  })

  it("keeps transport and settings registration singular after a worker restart", async () => {
    vi.useFakeTimers()
    const workers: FakeWorker[] = []
    const unsubscribeSettings = vi.fn()
    const subscribeSpy = vi
      .spyOn(useSettingsStore, "subscribe")
      .mockReturnValue(unsubscribeSettings)
    const transport = new NDKWorkerTransport(() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker as unknown as Worker
    })
    const ndk = {transportPlugins: []} as unknown as NDK

    try {
      await transport.connect(ndk, ["wss://relay.example"])
      expect(ndk.transportPlugins).toEqual([transport])
      expect(subscribeSpy).toHaveBeenCalledTimes(1)

      const restarting = (
        transport as unknown as {handleWorkerCrash: () => Promise<void>}
      ).handleWorkerCrash()
      await vi.advanceTimersByTimeAsync(1000)
      await restarting

      expect(workers).toHaveLength(2)
      expect(ndk.transportPlugins).toEqual([transport])
      expect(subscribeSpy).toHaveBeenCalledTimes(1)

      transport.close()
      expect(ndk.transportPlugins).toEqual([])
      expect(unsubscribeSettings).toHaveBeenCalledOnce()
    } finally {
      subscribeSpy.mockRestore()
      vi.useRealTimers()
    }
  })
})
