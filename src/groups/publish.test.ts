import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {verifyEvent} from "nostr-tools"
import NDK, {NDKEvent, NDKPrivateKeySigner, NDKRelay, NDKRelaySet} from "@/lib/ndk"
import {publishGroupEvent} from "./publish"

const runtime = vi.hoisted(() => ({
  instance: undefined as NDK | undefined,
  publicKey: "",
  workerAvailable: true,
  publish: vi.fn(),
  cacheEvent: vi.fn(),
}))

vi.mock("@/utils/ndk", () => ({
  ndk: () => runtime.instance,
  getWorkerTransport: () =>
    runtime.workerAvailable ? {publish: runtime.publish} : undefined,
}))
vi.mock("@/utils/eventCache", () => ({cacheEvent: runtime.cacheEvent}))
vi.mock("@/stores/user", () => ({
  useUserStore: {getState: () => ({publicKey: runtime.publicKey})},
}))

const draft = () => ({
  kind: 7368,
  content: "",
  tags: [["h", "00000000-0000-4000-8000-000000000000"]],
})

function pauseSigning(signer: NDKPrivateKeySigner) {
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>((resolve) => (entered = resolve))
  const gate = new Promise<void>((resolve) => (release = resolve))
  const sign = signer.sign.bind(signer)
  vi.spyOn(signer, "sign").mockImplementation(async (event) => {
    entered()
    await gate
    return sign(event)
  })
  return {started, release: () => release()}
}

describe("acknowledged group publishing", () => {
  let instance: NDK
  let signer: NDKPrivateKeySigner
  let dispatch: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    instance = new NDK({explicitRelayUrls: []})
    // Each test has its own account, including the publisher's per-account queue.
    signer = NDKPrivateKeySigner.generate()
    instance.signer = signer
    runtime.instance = instance
    runtime.publicKey = signer.pubkey
    runtime.workerAvailable = true
    runtime.publish.mockReset().mockResolvedValue(undefined)
    runtime.cacheEvent.mockReset()
    dispatch = vi.spyOn(instance.subManager, "dispatchEvent").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function expectUnpublished() {
    expect(runtime.publish).not.toHaveBeenCalled()
    expect(runtime.cacheEvent).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  }

  it("does not cache or dispatch a signed event rejected by the relay", async () => {
    runtime.publish.mockRejectedValueOnce(new Error("Relay rejected the event"))
    await expect(publishGroupEvent(draft(), ["wss://relay.example"])).rejects.toThrow(
      "Relay rejected the event"
    )
    expect(runtime.publish).toHaveBeenCalledOnce()
    const [event, relays, options] = runtime.publish.mock.calls[0]
    expect(event).toBeInstanceOf(NDKEvent)
    expect(verifyEvent(event.rawEvent())).toBe(true)
    expect(relays.map((relay: {url: string}) => relay.url)).toEqual([
      "wss://relay.example/",
    ])
    expect(options).toEqual({requireAck: true})
    expect(runtime.cacheEvent).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("waits for acknowledgement before caching and dispatching", async () => {
    let acknowledge!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => (entered = resolve))
    runtime.publish.mockImplementationOnce(() => {
      entered()
      return new Promise<void>((resolve) => (acknowledge = resolve))
    })
    const publishing = publishGroupEvent(draft())
    await started
    expect(runtime.cacheEvent).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    acknowledge()
    const event = await publishing
    expect(runtime.cacheEvent).toHaveBeenCalledExactlyOnceWith(event)
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(event, undefined, true)
  })

  it("does not send when the active account changes during signing", async () => {
    const signing = pauseSigning(signer)
    const publishing = publishGroupEvent(draft())
    const rejected = expect(publishing).rejects.toThrow("Your account changed")
    await signing.started
    runtime.publicKey = NDKPrivateKeySigner.generate().pubkey
    signing.release()
    await rejected
    expectUnpublished()
  })

  it("does not produce an optimistic echo when the fallback relay rejects", async () => {
    runtime.workerAvailable = false
    const relay = new NDKRelay("wss://relay.example", undefined, instance)
    const relaySet = new NDKRelaySet(new Set([relay]), instance)
    instance.devWriteRelaySet = relaySet
    const send = vi.spyOn(relaySet, "publish").mockRejectedValue(new Error("Rejected"))
    const optimisticPublish = vi.spyOn(NDKEvent.prototype, "publish")
    const seen = vi.spyOn(instance.subManager, "seenEvent")
    await expect(publishGroupEvent(draft())).rejects.toThrow("Rejected")
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0].slice(1)).toEqual([10_000, 1])
    expect(optimisticPublish).not.toHaveBeenCalled()
    expect(seen).not.toHaveBeenCalled()
    expectUnpublished()
  })

  it("dispatches exactly once after the fallback confirms a relay accepted the event", async () => {
    runtime.workerAvailable = false
    const relay = new NDKRelay("wss://relay.example", undefined, instance)
    const relaySet = new NDKRelaySet(new Set([relay]), instance)
    instance.devWriteRelaySet = relaySet
    let acknowledge!: (relays: Set<NDKRelay>) => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => (entered = resolve))
    vi.spyOn(relaySet, "publish").mockImplementation(() => {
      entered()
      return new Promise<Set<NDKRelay>>((resolve) => (acknowledge = resolve))
    })
    const optimisticPublish = vi.spyOn(NDKEvent.prototype, "publish")
    const seen = vi.spyOn(instance.subManager, "seenEvent")
    const publishing = publishGroupEvent(draft())
    await started
    expectUnpublished()
    expect(seen).not.toHaveBeenCalled()
    acknowledge(new Set([relay]))
    const event = await publishing
    expect(verifyEvent(event.rawEvent())).toBe(true)
    expect(optimisticPublish).not.toHaveBeenCalled()
    expect(seen).toHaveBeenCalledExactlyOnceWith(event.id, relay)
    expect(runtime.cacheEvent).toHaveBeenCalledExactlyOnceWith(event)
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(event, undefined, true)
  })

  it("does not send a vote when a slow signer returns after the deadline", async () => {
    const signing = pauseSigning(signer)
    const publishing = publishGroupEvent(draft(), undefined, {beforeTimestamp: 1000})
    const rejected = expect(publishing).rejects.toThrow("This poll has closed")
    await signing.started
    vi.setSystemTime(1_001_000)
    signing.release()
    await rejected
    expectUnpublished()
  })

  it("also enforces the real deadline for a previously signed event", async () => {
    const event = new NDKEvent(instance, draft())
    await event.sign()
    vi.setSystemTime(1_001_000)
    await expect(
      publishGroupEvent(event, undefined, {beforeTimestamp: 1000})
    ).rejects.toThrow("This poll has closed")
    expectUnpublished()
  })

  it("serializes same-second fact changes into increasing signed timestamps", async () => {
    const first = await publishGroupEvent(draft())
    const secondPublishing = publishGroupEvent({...draft(), tags: [["status", "left"]]})
    await vi.advanceTimersByTimeAsync(999)
    expect(runtime.publish).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    const second = await secondPublishing
    expect([first.created_at, second.created_at]).toEqual([1000, 1001])
    expect(first.id).not.toBe(second.id)
    expect(verifyEvent(first.rawEvent())).toBe(true)
    expect(verifyEvent(second.rawEvent())).toBe(true)
    expect(runtime.publish).toHaveBeenCalledTimes(2)
    expect(runtime.cacheEvent).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it("waits beyond an observed response timestamp and refuses if the poll closes", async () => {
    const publishing = publishGroupEvent(draft(), undefined, {
      afterTimestamp: 1000,
      beforeTimestamp: 1000,
    })
    const rejected = expect(publishing).rejects.toThrow("This poll has closed")
    await vi.advanceTimersByTimeAsync(1000)
    await rejected
    expectUnpublished()
  })

  it("signs a poll in a later second than its newest committed evidence", async () => {
    const publishing = publishGroupEvent({...draft(), kind: 1068}, undefined, {
      afterTimestamp: 1000,
    })
    await vi.advanceTimersByTimeAsync(999)
    expectUnpublished()
    await vi.advanceTimersByTimeAsync(1)
    const event = await publishing
    expect(event.created_at).toBe(1001)
    expect(verifyEvent(event.rawEvent())).toBe(true)
  })
})
