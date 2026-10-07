import {expect, test} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {Relay} from "nostr-tools/relay"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

for (const hiddenIdentity of ["author", "mention"]) {
  test(`reply count follows the thread's live ${hiddenIdentity} moderation`, async ({
    page,
  }) => {
    const viewer = generateSecretKey()
    const friends = Array.from({length: 3}, () => generateSecretKey())
    const target = generateSecretKey()
    const targetPubkey = getPublicKey(target)
    const now = Math.floor(Date.now() / 1000) - 60
    const sign = (key: Uint8Array, kind: number, tags: string[][], content = "") =>
      finalizeEvent({kind, tags, content, created_at: now}, key)
    const post = sign(viewer, 1, [], `Thread with moderated ${hiddenIdentity}`)
    const reply = sign(
      hiddenIdentity === "author" ? target : friends[0],
      1,
      [
        ["e", post.id, "", "root"],
        ["p", getPublicKey(viewer)],
        ...(hiddenIdentity === "mention" ? [["p", targetPubkey]] : []),
      ],
      `Reply with moderated ${hiddenIdentity}`
    )
    const relay = await startNostrRelay({
      port: 0,
      initialEvents: [
        post,
        reply,
        sign(
          viewer,
          3,
          friends.map((key) => ["p", getPublicKey(key)])
        ),
        ...friends.map((key, index) =>
          sign(key, 3, index < 2 ? [["p", targetPubkey]] : [])
        ),
        ...friends.map((key) => sign(key, 10000, [])),
      ],
    })
    let publisher: Relay | undefined
    try {
      await page.addInitScript((port) => {
        window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
      }, relay.port)
      await signUp(page, nip19.nsecEncode(viewer))
      await page.goto(`/${nip19.noteEncode(post.id)}`)
      const replyCount = page.getByRole("button", {name: "Reply", exact: true}).first()
      const replyRow = page.getByText(reply.content, {exact: true})
      await expect(replyRow).toBeVisible()
      await expect(replyCount).toHaveText("1")

      publisher = await Relay.connect(relay.url)
      // Two nearest follows and one mute pass the old counter's 1:1 rule,
      // but the thread's 3:1 moderation rule hides this identity.
      await publisher.publish(
        finalizeEvent(
          {
            kind: 10000,
            tags: [["p", targetPubkey]],
            content: "",
            created_at: now + 1,
          },
          friends[2]
        )
      )
      await expect(replyRow).toHaveCount(0)
      await expect(replyCount).toHaveText("0")

      // A later unmute must restore both from the already received reply.
      await publisher.publish(
        finalizeEvent(
          {kind: 10000, tags: [], content: "", created_at: now + 2},
          friends[2]
        )
      )
      await expect(replyRow).toBeVisible()
      await expect(replyCount).toHaveText("1")
    } finally {
      publisher?.close()
      await relay.close()
    }
  })
}
