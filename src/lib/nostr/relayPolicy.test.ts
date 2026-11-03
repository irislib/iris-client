import {describe, expect, it} from "vitest"
import {relayHintsFromUrls} from "./relayPolicy"

describe("relay addresses learned from public events", () => {
  it.each([
    "ws://relay.example",
    "ws://box.local:4848",
    "wss://Box.LOCAL./relay",
    "wss://nas",
    "wss://localhost",
    "wss://box.localhost",
    "wss://box.home.arpa",
    "wss://router.lan",
    "wss://vpn.internal",
    "wss://user:password@relay.example",
    "wss://127.1",
    "wss://0x7f000001",
    "wss://2130706433",
    "wss://0.0.0.0",
    "wss://10.1.2.3",
    "wss://100.64.0.1",
    "wss://169.254.1.1",
    "wss://172.31.2.3",
    "wss://192.168.0.1",
    "wss://198.19.0.1",
    "wss://224.0.0.1",
    "wss://[::]",
    "wss://[::1]",
    "wss://[fd01::1]",
    "wss://[fe80::1]",
    "wss://[ff02::1]",
    "wss://[::ffff:192.168.1.2]",
    "wss://[2002:7f00:1::1]",
  ])("ignores %s", (url) => {
    expect(relayHintsFromUrls([url])).toEqual([])
  })

  it("counts only distinct eligible destinations toward the limit", () => {
    expect(
      relayHintsFromUrls(
        [
          "ws://box.local",
          "wss://Relay.Example/",
          "wss://relay.example",
          "wss://8.8.8.8:8443/path",
          "wss://[2606:4700:4700::1111]",
          "wss://next.example",
        ],
        3
      )
    ).toEqual([
      "wss://relay.example",
      "wss://8.8.8.8:8443/path",
      "wss://[2606:4700:4700::1111]",
    ])
  })
})
