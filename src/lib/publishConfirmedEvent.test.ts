import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import NDK, {NDKEvent, NDKPrivateKeySigner, NDKRelay, NDKRelaySet} from "./ndk"
import {publishConfirmedEvent} from "./publishConfirmedEvent"

describe("confirmed publishing", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function setup() {
    const ndk = new NDK()
    const event = new NDKEvent(ndk, {kind: 1, content: "A group post"})
    await event.sign(NDKPrivateKeySigner.generate())
    const accepting = new NDKRelay("wss://accepting.example", undefined, ndk)
    const silent = new NDKRelay("wss://silent.example", undefined, ndk)
    const relays = new NDKRelaySet(new Set([accepting, silent]), ndk)
    const dispatch = vi.spyOn(ndk.subManager, "dispatchEvent")
    vi.spyOn(silent, "publish").mockImplementation(
      () =>
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10_000))
    )
    return {ndk, event, accepting, silent, relays, dispatch}
  }

  it("confirms the first acceptance while another relay remains silent", async () => {
    const {event, accepting, silent, relays, dispatch} = await setup()
    vi.spyOn(accepting, "publish").mockImplementation(async () => {
      event.emit("relay:published", accepting)
      return true
    })
    const confirmed = vi.fn()
    const pending = publishConfirmedEvent(event, relays).then(confirmed)
    await vi.advanceTimersByTimeAsync(1)
    expect(confirmed).toHaveBeenCalledWith(new Set([accepting]))
    expect(silent.publish).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledOnce()
    await pending
    await vi.advanceTimersByTimeAsync(10_000)
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it("does not confirm a rejected write or an acknowledgement from another relay", async () => {
    const {ndk, event, accepting, relays, dispatch} = await setup()
    vi.spyOn(accepting, "publish").mockRejectedValue(new Error("blocked"))
    const rejected = expect(publishConfirmedEvent(event, relays)).rejects.toThrow(
      "No relay confirmed the event."
    )
    event.emit("relay:published", new NDKRelay("wss://unrelated.example", undefined, ndk))
    await vi.advanceTimersByTimeAsync(10_000)
    await rejected
    expect(dispatch).not.toHaveBeenCalled()
  })
})
