import {expect, test} from "@playwright/test"
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  type VerifiedEvent,
} from "nostr-tools"
import WebSocket from "ws"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"
import {mkdir} from "node:fs/promises"
import {ensureCurrentDeviceRegistered} from "./private-messaging-helpers"

async function publish(url: string, event: VerifiedEvent) {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url)
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
}

test("private favorites and approved names survive profile changes and chat reloads", async ({
  page,
}) => {
  test.setTimeout(90000)
  const secret = generateSecretKey()
  const peer = getPublicKey(secret)
  const timestamp = Math.floor(Date.now() / 1000) - 120
  const profile = (name: string, offset: number) =>
    finalizeEvent(
      {
        kind: 0,
        created_at: timestamp + offset,
        tags: [],
        content: JSON.stringify({name}),
      },
      secret
    )
  const published: VerifiedEvent[] = []
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [profile("Alice Original", 0)],
    acknowledgeEvent: (event, acknowledge) => {
      published.push(event)
      acknowledge()
    },
  })
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
    const account = await signUp(page, "Contact Memory Test")
    await ensureCurrentDeviceRegistered(page)
    await page.goto(`/${nip19.npubEncode(peer)}`)
    const main = page.locator("#main-content")
    await expect(main.getByText("Alice Original", {exact: true}).first()).toBeVisible()
    const memory = () =>
      page.evaluate(
        ({account, peer}) => {
          const state = JSON.parse(
            localStorage.getItem("contact-memory-storage") || "{}"
          ).state
          return state?.accounts?.[account]?.[peer]
        },
        {account: account.publicKey!, peer}
      )
    expect(await memory()).toBeUndefined()

    await page.getByRole("button", {name: "Start chat", exact: true}).click()
    await expect.poll(async () => (await memory())?.accepted_name).toBe("Alice Original")
    await page.goto(`/${nip19.npubEncode(peer)}`)
    await page.getByRole("button", {name: "Favorite", exact: true}).click()
    await expect(
      page.getByRole("button", {name: "Favorited", exact: true})
    ).toHaveAttribute("aria-pressed", "true")
    await expect(
      page.getByTestId("profile-hero-avatar").getByTitle("Following", {exact: true})
    ).toHaveCount(0)
    await expect(page.getByText("Only you can see this", {exact: true})).toBeVisible()
    expect(published.some((event) => event.kind === 3)).toBe(false)

    await publish(relay.url, profile("Alicia Updated", 10))
    await page.reload()
    const proposal = page.getByTestId("contact-name-change")
    await expect(proposal).toContainText("Alice Original now goes by Alicia Updated.")
    await expect(main.getByText("Alice Original", {exact: true}).first()).toBeVisible()
    expect((await memory()).accepted_name).toBe("Alice Original")
    await page.setViewportSize({width: 390, height: 844})
    await mkdir("work/contact-memory", {recursive: true})
    await page.screenshot({
      path: "work/contact-memory/profile-pending-mobile.png",
      fullPage: true,
    })
    await proposal.getByRole("button", {name: "Use new name", exact: true}).click()
    await expect(proposal).toHaveCount(0)
    await expect(main.getByText("Alicia Updated", {exact: true}).first()).toBeVisible()
    await expect(
      page.getByText("First known as Alice Original", {exact: true})
    ).toBeVisible()
    expect((await memory()).name_changes).toMatchObject([
      {previous_name: "Alice Original", accepted_name: "Alicia Updated"},
    ])

    await page.getByRole("button", {name: "Start chat", exact: true}).click()
    await expect(page.getByTestId("contact-name-history")).toContainText(
      "Alice Original → Alicia Updated"
    )
    await page.screenshot({
      path: "work/contact-memory/chat-approved-mobile.png",
      fullPage: true,
    })
    await publish(relay.url, profile("Alice Again", 20))
    await page.goto(`/${nip19.npubEncode(peer)}`)
    await page.reload()
    await expect(page.getByTestId("contact-name-change")).toContainText("Alice Again")
    await page.getByRole("button", {name: "Start chat", exact: true}).click()
    await expect(page.getByTestId("contact-name-change")).toContainText(
      "Alicia Updated now goes by Alice Again."
    )
    await page.getByRole("button", {name: "Use new name", exact: true}).click()
    await expect(page.getByTestId("contact-name-history")).toHaveCount(2)
    await page.goto(`/${nip19.npubEncode(peer)}`)
    await page.reload()
    expect((await memory()).first_seen_name).toBe("Alice Original")
    expect((await memory()).accepted_name).toBe("Alice Again")
    expect((await memory()).favorite).toBe(true)
    await page.getByRole("button", {name: "Favorited", exact: true}).click()
    expect((await memory()).favorite).toBe(false)
    expect(
      published
        .filter((event) => event.pubkey === account.publicKey)
        .every(
          (event) =>
            !event.content.includes("Alice Original") &&
            !event.content.includes("Alicia Updated")
        )
    ).toBe(true)
    const followButton = page
      .getByTestId("profile-header-actions")
      .getByTitle("Your follows are public")
    await followButton.click()
    await page.mouse.move(0, 0)
    await expect(
      page.getByTestId("profile-hero-avatar").getByTitle("Following", {exact: true})
    ).toBeVisible()
    const graphBadge = page
      .getByTestId("profile-hero-avatar")
      .getByTitle("Following", {exact: true})
    await expect(graphBadge).toHaveCSS("background-color", "rgb(10, 132, 255)")
    const badgeBounds = await graphBadge.boundingBox()
    const avatarBounds = await graphBadge.locator("..").boundingBox()
    expect(badgeBounds && avatarBounds).toBeTruthy()
    expect(badgeBounds!.y + badgeBounds!.height / 2).toBeLessThan(
      avatarBounds!.y + avatarBounds!.height / 2
    )
    expect(badgeBounds!.x + badgeBounds!.width / 2).toBeGreaterThan(
      avatarBounds!.x + avatarBounds!.width / 2
    )
    await expect(page.getByText("Followed by you", {exact: true})).toBeVisible()
    expect(published.filter((event) => event.kind === 3).at(-1)?.tags).toContainEqual([
      "p",
      peer,
    ])
    await page.setViewportSize({width: 1280, height: 900})
    await page.screenshot({
      path: "work/contact-memory/profile-following-desktop.png",
      fullPage: true,
    })
    await followButton.click()
    await expect(
      page.getByTestId("profile-hero-avatar").getByTitle("Following", {exact: true})
    ).toHaveCount(0)
    expect(published.filter((event) => event.kind === 3).at(-1)?.tags).not.toContainEqual(
      ["p", peer]
    )
  } finally {
    await relay.close()
  }
})
