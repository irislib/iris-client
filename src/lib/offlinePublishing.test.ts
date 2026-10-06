import {afterEach, describe, expect, it, vi} from "vitest"
import {
  createNostrRuntime,
  MemoryEventStore,
  type NostrRuntime,
  type PublishReport,
} from "nostr-pubsub"
import {finalizeEvent, generateSecretKey} from "nostr-tools"

const runtimes: NostrRuntime[] = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
})

function setup() {
  const store = new MemoryEventStore()
  let acknowledge!: (report: PublishReport) => void
  const publish = vi.fn(
    () =>
      new Promise<PublishReport>((resolve) => {
        acknowledge = resolve
      })
  )
  const runtime = createNostrRuntime({store, sources: [{id: "test-relay", publish}]})
  runtimes.push(runtime)
  const event = finalizeEvent(
    {
      kind: 1,
      content: "Saved offline",
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    },
    generateSecretKey()
  )
  return {
    runtime,
    store,
    event,
    publish,
    acknowledge: (accepted = true) => acknowledge({accepted, priority: 1}),
  }
}

describe("offline-first publication", () => {
  it("commits and returns before a silent relay responds, then retires the outbox entry", async () => {
    const {runtime, store, event, publish, acknowledge} = setup()
    const publication = runtime.publish(event)
    try {
      const result = await Promise.race([
        publication,
        new Promise((resolve) => setTimeout(() => resolve("waited for relay"), 100)),
      ])
      expect(result).toMatchObject({queued: true, remoteAccepted: false})
      expect(await store.query([{ids: [event.id]}])).toEqual([
        JSON.parse(JSON.stringify(event)),
      ])
      expect((await store.listPending()).map((entry) => entry.event.id)).toEqual([
        event.id,
      ])
      expect(publish).toHaveBeenCalledOnce()
      expect(runtime.publish(event)).toBe(publication)
    } finally {
      acknowledge()
      await publication
    }
    await vi.waitFor(async () => expect(await store.listPending()).toEqual([]))
  })

  it("retains a rejected publication and retries the same signed event", async () => {
    const {runtime, store, event, publish, acknowledge} = setup()
    publish.mockResolvedValueOnce({accepted: false, priority: 1})
    expect(await runtime.publish(event)).toMatchObject({
      queued: true,
      remoteAccepted: false,
    })
    expect((await store.listPending()).map((entry) => entry.event.id)).toEqual([event.id])
    await runtime.retryPending()
    const retry = runtime.retryPending()
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(2))
    acknowledge()
    await retry
    await vi.waitFor(async () => expect(await store.listPending()).toEqual([]))
    expect(
      publish.mock.calls.map((call) => (call as unknown as [typeof event])[0].id)
    ).toEqual([event.id, event.id])
    expect(await store.query([{ids: [event.id]}])).toEqual([
      JSON.parse(JSON.stringify(event)),
    ])
  })

  it("preserves the draft boundary when local storage fails", async () => {
    const {runtime, store, event, publish} = setup()
    vi.spyOn(store, "putPending").mockRejectedValue(new Error("Storage full"))
    await expect(runtime.publish(event)).rejects.toThrow("Storage full")
    expect(publish).not.toHaveBeenCalled()
    expect(await store.query([{ids: [event.id]}])).toEqual([])
  })

  it("keeps explicit delivery confirmation for callers that need it", async () => {
    const {runtime, store, event, publish, acknowledge} = setup()
    let completed = false
    const publication = runtime.publish(event, {requireAck: true}).then((result) => {
      completed = true
      return result
    })
    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce())
    expect(completed).toBe(false)
    expect(await store.listPending()).toEqual([])
    acknowledge()
    expect(await publication).toMatchObject({queued: false, remoteAccepted: true})
  })
})
