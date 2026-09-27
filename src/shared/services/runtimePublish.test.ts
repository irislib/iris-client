import localforage from "localforage"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import type {VerifiedEvent} from "nostr-tools"
import {createRuntimePublish} from "./runtimePublish"

const waitFor = (assertion: () => void | Promise<void>) =>
  vi.waitFor(assertion, {interval: 1, timeout: 1000})

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return {promise, resolve}
}

const envelope = (id: string): VerifiedEvent =>
  ({
    id: id.repeat(64),
    pubkey: "e".repeat(64),
    created_at: 100,
    kind: 1060,
    tags: [["p", "f".repeat(64)]],
    content: `encrypted:${id}`,
    sig: id.repeat(128),
  }) as VerifiedEvent

let storage: typeof localforage
const queues: ReturnType<typeof createRuntimePublish>[] = []

beforeEach(async () => {
  storage = localforage.createInstance({
    name: `runtime-publish-test-${crypto.randomUUID()}`,
    driver: localforage.INDEXEDDB,
  })
  await storage.ready()
})

afterEach(async () => {
  for (const queue of queues.splice(0)) queue.close()
  vi.restoreAllMocks()
  vi.useRealTimers()
  await storage.dropInstance()
})

const createQueue = (
  publish: Parameters<typeof createRuntimePublish>[0]["publish"],
  options: Partial<Parameters<typeof createRuntimePublish>[0]> = {}
) => {
  const queue = createRuntimePublish({
    owner: "owner-a",
    storage,
    publish,
    onError: vi.fn(),
    ...options,
  })
  queues.push(queue)
  return queue
}

const storedRows = async () =>
  Promise.all((await storage.keys()).map((key) => storage.getItem(key)))

describe("durable runtime publication", () => {
  it("persists before dispatch and lets another send finish while an ACK never arrives", async () => {
    const stalled = deferred()
    const sent = new Set<string>()
    const publish = vi.fn(async (event: VerifiedEvent, innerEventId?: string) => {
      if (event.id === envelope("a").id) await stalled.promise
      sent.add(innerEventId!)
    })
    const queue = createQueue(publish)
    const first = envelope("a")
    await queue.enqueue(first, "inner-a")
    expect(publish).not.toHaveBeenCalled()
    expect(await storedRows()).toEqual([{event: first, innerEventId: "inner-a"}])

    void queue.publish(first, "inner-a").catch(() => {})
    await waitFor(() => expect(publish).toHaveBeenCalledOnce())
    await queue.enqueue(envelope("b"), "inner-b")
    await queue.publish(envelope("b"), "inner-b")

    expect(sent).toEqual(new Set(["inner-b"]))
    expect(await storedRows()).toEqual([{event: first, innerEventId: "inner-a"}])
  })

  it("does not dispatch when durable storage fails", async () => {
    const publish = vi.fn()
    const queue = createQueue(publish)
    vi.spyOn(storage, "setItem").mockRejectedValue(new Error("storage full"))

    await expect(queue.enqueue(envelope("a"), "inner-a")).rejects.toThrow("storage full")
    await expect(queue.publish(envelope("a"), "inner-a")).rejects.toThrow("storage full")
    expect(publish).not.toHaveBeenCalled()
    expect(await storage.keys()).toEqual([])
  })

  it("requires a signed envelope before queueing or publishing", async () => {
    const publish = vi.fn()
    const queue = createQueue(publish)
    await expect(queue.publish({...envelope("a"), sig: ""})).rejects.toThrow(
      "Cannot queue an unsigned event"
    )
    expect(await storage.keys()).toEqual([])
    expect(publish).not.toHaveBeenCalled()
  })

  it("confirms only the requested publication before cleanup, with a bounded wait", async () => {
    const accepted = deferred()
    const publish = vi.fn(async (event: VerifiedEvent) => {
      if (event.id === envelope("a").id) await accepted.promise
      else await new Promise(() => {})
    })
    const queue = createQueue(publish)
    await queue.enqueue(envelope("a"))
    await queue.enqueue(envelope("b"))
    const confirmation = queue.waitForDelivery(
      (event) => event.id === envelope("a").id,
      1000
    )
    await waitFor(() => expect(publish).toHaveBeenCalledOnce())
    accepted.resolve()
    await confirmation
    expect(await storedRows()).toEqual([{event: envelope("b"), innerEventId: undefined}])
    await expect(queue.waitForDelivery(() => true, 10)).rejects.toThrow("timed out")
    expect(await storedRows()).toHaveLength(1)
  })

  it("restores the exact failed envelope only for its owner in a new instance", async () => {
    const original = envelope("a")
    const failed = createQueue(async () => {
      throw new Error("relay offline")
    })
    await expect(failed.publish(original, "inner-a")).rejects.toThrow("relay offline")
    failed.close()
    original.content = "caller changed the object"

    const otherPublish = vi.fn()
    const other = createQueue(otherPublish, {owner: "owner-b"})
    const keys = vi.spyOn(storage, "keys")
    other.start()
    await waitFor(() => expect(keys).toHaveBeenCalled())
    await storage.keys()
    expect(otherPublish).not.toHaveBeenCalled()

    const restoredPublish = vi.fn(async () => {})
    const restored = createQueue(restoredPublish, {
      storage: localforage.createInstance({
        name: storage.config().name,
        driver: localforage.INDEXEDDB,
      }),
    })
    restored.start()
    await waitFor(() => expect(restoredPublish).toHaveBeenCalledOnce())
    expect(restoredPublish.mock.calls[0]).toEqual([
      envelope("a"),
      "inner-a",
      expect.any(AbortSignal),
    ])
    await waitFor(async () => expect(await storage.keys()).toEqual([]))
  })

  it("shares an in-flight publication for the same envelope", async () => {
    const ack = deferred()
    const publish = vi.fn(() => ack.promise)
    const queue = createQueue(publish)
    const first = queue.publish(envelope("a"), "inner-a")
    const duplicate = queue.publish(envelope("a"), "inner-a")

    await waitFor(() => expect(publish).toHaveBeenCalledOnce())
    ack.resolve()
    await Promise.all([first, duplicate])
    expect(publish).toHaveBeenCalledOnce()
    expect(await storage.keys()).toEqual([])
  })

  it("aborts stale-account work and retains the row when ACK arrives after close", async () => {
    const ack = deferred()
    const sent = vi.fn()
    const publish = vi.fn(async (_event, _innerEventId, signal) => {
      await ack.promise
      if (!signal.aborted) sent()
    })
    const queue = createQueue(publish)
    const pending = queue.publish(envelope("a"), "inner-a")
    const rejected = expect(pending).rejects.toMatchObject({name: "AbortError"})
    await waitFor(() => expect(publish).toHaveBeenCalledOnce())

    queue.close()
    expect(publish.mock.calls[0][2].aborted).toBe(true)
    ack.resolve()
    await rejected
    expect(sent).not.toHaveBeenCalled()
    expect(await storedRows()).toEqual([{event: envelope("a"), innerEventId: "inner-a"}])
    await expect(queue.enqueue(envelope("b"))).rejects.toMatchObject({name: "AbortError"})
    expect(await storage.keys()).toHaveLength(1)
  })

  it("rejects an enqueue interrupted by account cleanup without dispatching", async () => {
    const write = deferred()
    const setItem = storage.setItem.bind(storage)
    vi.spyOn(storage, "setItem").mockImplementation(async (key, value) => {
      await write.promise
      return setItem(key, value)
    })
    const publish = vi.fn()
    const queue = createQueue(publish)
    const pending = queue.enqueue(envelope("a"), "inner-a")
    const rejected = expect(pending).rejects.toMatchObject({name: "AbortError"})
    await waitFor(() => expect(storage.setItem).toHaveBeenCalledOnce())
    queue.close()
    write.resolve()
    await rejected
    expect(publish).not.toHaveBeenCalled()
  })

  it("reports retry failures and removes online listeners and timers on close", async () => {
    vi.useFakeTimers({toFake: ["setInterval", "clearInterval"]})
    const onlineTarget = new EventTarget()
    const publish = vi.fn(async () => {
      throw new Error("not acknowledged")
    })
    const onError = vi.fn()
    const queue = createQueue(publish, {onlineTarget, onError, retryIntervalMs: 1000})
    await queue.enqueue(envelope("a"), "inner-a")
    queue.start()
    queue.start()
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))

    onlineTarget.dispatchEvent(new Event("online"))
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(2))
    await vi.advanceTimersByTimeAsync(1000)
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(3))

    queue.close()
    expect(vi.getTimerCount()).toBe(0)
    onlineTarget.dispatchEvent(new Event("online"))
    await vi.advanceTimersByTimeAsync(2000)
    expect(publish).toHaveBeenCalledTimes(3)
    expect(await storage.keys()).toHaveLength(1)
  })
})
