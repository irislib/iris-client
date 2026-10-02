import {expect, test} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import WebSocket from "ws"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

test("a mounted profile receives metadata after empty history and a delayed relay arrival", async ({
  page,
}) => {
  const secret = generateSecretKey()
  const pubkey = getPublicKey(secret)
  const relay = await startNostrRelay({port: 0})
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
    await signUp(page, "Late profile test")
    await page.goto(`/${nip19.npubEncode(pubkey)}`)
    await expect(page.getByTestId("profile-header-actions")).toBeVisible()
    // An empty history response and the runtime's five-second history bound
    // must not turn a mounted profile's subscription into a permanent miss.
    await page.waitForTimeout(6000)
    const event = finalizeEvent(
      {
        kind: 0,
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
        content: JSON.stringify({name: "Profile arrived after reconnect"}),
      },
      secret
    )
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(relay.url)
      socket.on("error", reject)
      socket.on("open", () => socket.send(JSON.stringify(["EVENT", event])))
      socket.on("message", (data) => {
        const message = JSON.parse(String(data))
        if (message[0] === "OK" && message[1] === event.id) {
          socket.close()
          message[2] ? resolve() : reject(new Error(message[3]))
        }
      })
    })
    await expect(
      page.getByText("Profile arrived after reconnect", {exact: true}).first()
    ).toBeVisible()
  } finally {
    await relay.close()
  }
})
