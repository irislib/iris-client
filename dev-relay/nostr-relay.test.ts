import {describe, expect, it} from "vitest"
import WebSocket from "ws"
import {finalizeEvent, generateSecretKey, getPublicKey} from "nostr-tools"

import {startNostrRelay} from "./nostr-relay.js"

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: any) => boolean,
  timeoutMs = 2000
) {
  return new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("timeout waiting for message")),
      timeoutMs
    )
    const onMessage = (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(String(data))
        if (predicate(msg)) {
          cleanup()
          resolve(msg)
        }
      } catch {
        // ignore
      }
    }
    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }
    const cleanup = () => {
      clearTimeout(timeout)
      ws.off("message", onMessage)
      ws.off("error", onError)
    }
    ws.on("message", onMessage)
    ws.on("error", onError)
  })
}

describe("dev-relay nostr relay (node)", () => {
  it("replays stored events + sends EOSE", async () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "hello world",
        pubkey: pk,
      },
      sk
    )

    const relay = await startNostrRelay({port: 0, initialEvents: [event as any]})
    const ws = new WebSocket(relay.url)
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve())
      ws.once("error", reject)
    })

    try {
      const gotEventP = waitForMessage(
        ws,
        (m) =>
          Array.isArray(m) &&
          m[0] === "EVENT" &&
          m[1] === "sub-1" &&
          m[2]?.id === event.id
      )
      const eoseP = waitForMessage(
        ws,
        (m) => Array.isArray(m) && m[0] === "EOSE" && m[1] === "sub-1"
      )
      ws.send(JSON.stringify(["REQ", "sub-1", {kinds: [1], limit: 10}]))

      const gotEvent = await gotEventP
      expect(gotEvent[2].content).toBe("hello world")
      await eoseP
    } finally {
      ws.close()
      await relay.close()
    }
  })

  it("broadcasts published events to matching subscriptions", async () => {
    const relay = await startNostrRelay({port: 0})
    const ws = new WebSocket(relay.url)
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve())
      ws.once("error", reject)
    })

    try {
      const eoseP = waitForMessage(
        ws,
        (m) => Array.isArray(m) && m[0] === "EOSE" && m[1] === "sub-1"
      )
      ws.send(JSON.stringify(["REQ", "sub-1", {kinds: [1], limit: 10}]))
      await eoseP

      const sk = generateSecretKey()
      const pk = getPublicKey(sk)
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "published",
          pubkey: pk,
        },
        sk
      )

      const okP = waitForMessage(
        ws,
        (m) => Array.isArray(m) && m[0] === "OK" && m[1] === event.id && m[2] === true
      )
      const eventP = waitForMessage(
        ws,
        (m) =>
          Array.isArray(m) &&
          m[0] === "EVENT" &&
          m[1] === "sub-1" &&
          m[2]?.id === event.id
      )
      ws.send(JSON.stringify(["EVENT", event]))

      await okP
      await eventP
    } finally {
      ws.close()
      await relay.close()
    }
  })
})
