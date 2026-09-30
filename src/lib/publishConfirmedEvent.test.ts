import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import NostrClient, {AppEvent, SecretKeySigner, Relay, RelaySet} from "@/lib/nostr"
import {publishConfirmedEvent} from "./publishConfirmedEvent"

describe("confirmed publishing", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function setup() {
    const nostr = new NostrClient()
    const event = new AppEvent(nostr, {kind: 1, content: "A group post"})
    await event.sign(SecretKeySigner.generate())
    const accepting = new Relay("wss://accepting.example", undefined, nostr)
    const silent = new Relay("wss://silent.example", undefined, nostr)
    const relays = new RelaySet(new Set([accepting, silent]), nostr)
    const dispatch = vi.spyOn(nostr.subManager, "dispatchEvent")
    vi.spyOn(silent, "publish").mockImplementation(
      () =>
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10_000))
    )
    return {nostr, event, accepting, silent, relays, dispatch}
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
    const {nostr, event, accepting, relays, dispatch} = await setup()
    vi.spyOn(accepting, "publish").mockRejectedValue(new Error("blocked"))
    const rejected = expect(publishConfirmedEvent(event, relays)).rejects.toThrow(
      "No relay confirmed the event."
    )
    event.emit("relay:published", new Relay("wss://unrelated.example", undefined, nostr))
    await vi.advanceTimersByTimeAsync(10_000)
    await rejected
    expect(dispatch).not.toHaveBeenCalled()
  })
})
