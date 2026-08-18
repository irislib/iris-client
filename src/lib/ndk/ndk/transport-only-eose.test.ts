import {describe, expect, it, vi} from "vitest"
import {NDK} from "./index.js"

describe("transport-only subscription EOSE", () => {
  it("emits EOSE when its sole transport completes", () => {
    const ndk = new NDK({explicitRelayUrls: []})
    const onEose = vi.fn()
    const onSubscribe = vi.fn((subscription) => {
      subscription.eoseReceived(null)
    })

    ndk.transportPlugins.push({name: "worker-transport", onSubscribe})

    const subscription = ndk.subscribe(
      {kinds: [3]},
      {transports: ["worker-transport"], onEose},
      false
    )

    expect(onSubscribe).toHaveBeenCalledOnce()
    expect(onEose).toHaveBeenCalledOnce()
    expect(onEose.mock.calls[0][0]).toBe(subscription)

    subscription.stop()
  })
})
