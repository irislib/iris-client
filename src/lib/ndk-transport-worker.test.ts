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
