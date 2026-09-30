import {expect, test} from "@playwright/test"
import type {AddressInfo} from "node:net"
import {WebSocketServer} from "ws"
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  matchFilters,
  nip04,
  verifyEvent,
  type Event,
  type Filter,
} from "nostr-tools"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"

test.skip(usingBuiltDist, "the wallet harness imports app modules from the source server")

for (const accepts of [true, false]) {
  test(
    accepts
      ? "wallet requests retain their signer and dedicated response relay"
      : "rejected wallet actions are not retained for a later retry",
    async ({page}) => {
      const walletKey = generateSecretKey()
      const clientKey = generateSecretKey()
      const server = new WebSocketServer({host: "127.0.0.1", port: 0})
      await new Promise<void>((resolve) => server.once("listening", resolve))
      const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`
      let verifiedRequest = false
      let responseInterest = false
      server.on("connection", (socket) => {
        const interests = new Map<string, Filter[]>()
        let response: Event | undefined
        const deliver = () => {
          if (!response) return
          for (const [id, filters] of interests) {
            if (matchFilters(filters, response)) {
              responseInterest = true
              socket.send(JSON.stringify(["EVENT", id, response]))
            }
          }
        }
        socket.on("message", async (data) => {
          const frame = JSON.parse(String(data))
          if (frame[0] === "REQ") {
            interests.set(frame[1], frame.slice(2))
            deliver()
            socket.send(JSON.stringify(["EOSE", frame[1]]))
          } else if (frame[0] === "CLOSE") interests.delete(frame[1])
          else if (frame[0] === "EVENT" && frame[1].kind === 23194) {
            const request = frame[1] as Event
            const content = JSON.parse(
              await nip04.decrypt(walletKey, request.pubkey, request.content)
            )
            verifiedRequest =
              verifyEvent(request) && request.pubkey === getPublicKey(clientKey)
            expect(content.method).toBe("get_balance")
            if (!accepts) {
              socket.send(JSON.stringify(["OK", request.id, false, "blocked"]))
              return
            }
            response = finalizeEvent(
              {
                kind: 23195,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                  ["p", request.pubkey],
                  ["e", request.id],
                ],
                content: await nip04.encrypt(
                  walletKey,
                  request.pubkey,
                  JSON.stringify({
                    result_type: "get_balance",
                    result: {balance: 321000},
                  })
                ),
              },
              walletKey
            )
            socket.send(JSON.stringify(["OK", request.id, true, ""]))
            deliver()
          }
        })
      })
      try {
        await signUp(page, "Wallet session")
        const balance = await page.evaluate(
          async (config) => {
            const {SimpleNWCWallet} = await import("/src/utils/nwc.ts")
            const wallet = new SimpleNWCWallet(config)
            try {
              await wallet.connect()
              return await wallet.getBalance()
            } finally {
              wallet.disconnect()
            }
          },
          {
            pubkey: getPublicKey(walletKey),
            relayUrls: [url],
            secret: Buffer.from(clientKey).toString("hex"),
          }
        )
        expect(balance).toBe(accepts ? 321 : null)
        expect(verifiedRequest).toBe(true)
        expect(responseInterest).toBe(accepts)
        const pendingWalletActions = await page.evaluate(async () => {
          const {getMainThreadDb} = await import("/src/lib/nostr/db.ts")
          return (await getMainThreadDb().unpublishedEvents.toArray()).filter(
            (entry) => entry.event.kind === 23194
          ).length
        })
        expect(pendingWalletActions).toBe(0)
      } finally {
        for (const socket of server.clients) socket.terminate()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    }
  )
}
