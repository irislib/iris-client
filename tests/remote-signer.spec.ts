import {test, expect} from "@playwright/test"
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip44,
  verifyEvent,
  type Event,
} from "nostr-tools"

test("an existing account can pair once and sign a post after refresh", async ({
  page,
}) => {
  const account = generateSecretKey()
  const transport = generateSecretKey()
  const pubkey = getPublicKey(account)
  const relay = "wss://signer.invalid/"
  const link = `bunker://${getPublicKey(transport)}?relay=${encodeURIComponent(relay)}&secret=pair-once`
  const signed: Event[] = []
  let pairedClient = ""
  await page.routeWebSocket(relay, (socket) => {
    let subscription = ""
    socket.onMessage((raw) => {
      const [command, value] = JSON.parse(raw.toString())
      if (command === "REQ") {
        subscription = value
        socket.send(JSON.stringify(["EOSE", value]))
      }
      if (command !== "EVENT") return
      const event = value as Event
      expect(verifyEvent(event)).toBe(true)
      const key = nip44.v2.utils.getConversationKey(transport, event.pubkey)
      const {id, method, params} = JSON.parse(nip44.v2.decrypt(event.content, key))
      let result: string
      if (method === "connect") {
        expect(pairedClient).toBe("")
        expect(params[1]).toBe("pair-once")
        pairedClient = event.pubkey
        result = "ack"
      } else {
        expect(event.pubkey).toBe(pairedClient)
        if (method === "switch_relays") result = "null"
        else if (method === "get_public_key") result = pubkey
        else if (method === "sign_event") {
          const post = finalizeEvent(JSON.parse(params[0]), account)
          signed.push(post)
          result = JSON.stringify(post)
        } else throw new Error(`Unexpected signer method ${method}`)
      }
      socket.send(JSON.stringify(["OK", event.id, true, ""]))
      const response = finalizeEvent(
        {
          kind: 24133,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["p", event.pubkey]],
          content: nip44.v2.encrypt(JSON.stringify({id, result}), key),
        },
        transport
      )
      socket.send(JSON.stringify(["EVENT", subscription, response]))
    })
  })
  await page.addInitScript(() => {
    window.__HTREE_SERVER_URL__ = "http://127.0.0.1:7777"
  })
  const groups = process.env.NODE_CONFIG_ENV === "groups"
  await page.goto(groups ? "/groups" : "/")
  await page
    .getByRole("button", {name: groups ? "Create group" : "Sign up", exact: true})
    .first()
    .click()
  await page.getByRole("button", {name: "Sign in", exact: true}).click()
  await page.getByRole("button", {name: "Sign in with remote signer"}).click()
  await page
    .getByRole("dialog")
    .filter({has: page.getByPlaceholder(/bunker:/)})
    .screenshot({path: test.info().outputPath("signer-login.png")})
  await page.getByPlaceholder(/bunker:\/\//).fill(link)
  await page.getByRole("button", {name: "Connect", exact: true}).click()
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("user-storage") || "{}").state?.publicKey
      )
    )
    .toBe(pubkey)
  expect(await page.evaluate(() => localStorage.getItem("user-storage"))).not.toContain(
    "pair-once"
  )
  await page.reload()
  if (groups) {
    await page.getByRole("button", {name: "Create group", exact: true}).first().click()
    const create = page.getByRole("form", {name: "Create group"})
    await create.getByLabel("Name", {exact: true}).fill("Signer test group")
    await create.getByLabel("About & membership").fill("A local fixture group")
    await create.getByRole("button", {name: "Create group", exact: true}).click()
    await expect(page).toHaveURL(new RegExp(`/groups/${pubkey}/`))
    const composer = page.getByPlaceholder("Post to Signer test group")
    await composer.fill("Remote signer test post")
    await composer.press("Meta+Enter")
    await expect
      .poll(() =>
        signed.some(
          (event) =>
            event.pubkey === pubkey && event.content === "Remote signer test post"
        )
      )
      .toBe(true)
    return
  }
  await page.locator("#main-content").getByTestId("new-post-button").click()
  const dialog = page.getByRole("dialog")
  await dialog.getByPlaceholder("What's on your mind?").fill("Remote signer test post")
  await dialog.getByRole("button", {name: "Post", exact: true}).click()
  await expect
    .poll(() =>
      signed.some(
        (event) => event.pubkey === pubkey && event.content === "Remote signer test post"
      )
    )
    .toBe(true)
})
