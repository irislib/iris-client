import {test, expect} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {signUp} from "./auth.setup"
import {startNostrRelay} from "../dev-relay/nostr-relay"

test("user sees a highlighted notification when a followed user likes their post", async ({
  browser,
}) => {
  test.setTimeout(90000)
  const relay = await startNostrRelay({port: 0})
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  for (const context of [contextA, contextB]) {
    await context.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
  }
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  try {
    const userA = await signUp(pageA, "User A")
    const userB = await signUp(pageB, "User B")
    expect(userA.publicKey).toBeTruthy()
    expect(userB.publicKey).toBeTruthy()

    await pageA.goto(`/${nip19.npubEncode(userB.publicKey)}`)
    const profileActions = pageA.getByTestId("profile-header-actions")
    await profileActions.getByRole("button", {name: "Follow", exact: true}).click()
    // A followed profile shows "Unfollow" while the pointer rests on the button.
    await pageA.mouse.move(0, 0)
    await expect(
      profileActions.getByRole("button", {name: "Following", exact: true})
    ).toBeVisible()

    await pageA.locator('li a[href="/"]').click()
    await pageA.locator("#main-content").getByTestId("new-post-button").click()
    const postContent = `Notification test ${userA.publicKey.slice(0, 12)}`
    const composer = pageA.getByRole("dialog")
    await composer.getByPlaceholder("What's on your mind?").fill(postContent)
    await composer.getByRole("button", {name: "Post", exact: true}).click()
    await expect(pageA.getByText(postContent).first()).toBeVisible()

    // Activity on the currently viewed post is read immediately. Leave the
    // thread before the like arrives to exercise the unread notification path.
    await pageA.goto("/settings")
    await expect(pageA.getByText(postContent, {exact: true})).toHaveCount(0)

    await pageB.goto(`/${nip19.npubEncode(userA.publicKey)}`)
    const post = pageB.getByTestId("feed-item").filter({hasText: postContent}).first()
    await expect(post).toBeVisible({timeout: 20000})
    await post.getByTestId("like-button").click()
    await expect(post.getByTestId("like-count")).toHaveText("1")

    // Let the live graph and notification subscriptions finish. Reloading an
    // empty feed repeatedly cancels startup and can prevent the relay query.
    const notificationsLink = pageA.locator('li a[href="/notifications"]')
    await expect(notificationsLink.locator(".indicator-item.badge")).toBeVisible({
      timeout: 30000,
    })
    await notificationsLink.click()
    await expect(pageA.locator("header").getByText("Notifications")).toBeVisible()
    const notification = pageA
      .locator('div[class*="bg-info/20"]')
      .filter({hasText: "reacted"})
    await expect(notification).toBeVisible()
    await expect(
      notification.locator(`a[href="/${nip19.npubEncode(userB.publicKey)}"]`)
    ).toBeVisible()
    await expect(notification.getByText(postContent, {exact: true})).toBeVisible()
  } finally {
    await Promise.all([contextA.close(), contextB.close()])
    await relay.close()
  }
})

test("one daily reaction row opens every post and leaves shared activity visible", async ({
  page,
}, testInfo) => {
  const viewerKey = generateSecretKey()
  const senderKey = generateSecretKey()
  const otherKey = generateSecretKey()
  const viewer = getPublicKey(viewerKey)
  const sender = getPublicKey(senderKey)
  const day = Math.floor(Date.now() / 86400000) * 86400 - 3600
  const titles = [
    "Taking the long way home",
    "Winter light",
    "Garden notes",
    "The ferry crossing",
    "A new walking trail",
    "Evening colours",
    "Street photography",
    "At the market",
    "From the sketchbook",
    "First snow",
  ]
  const posts = titles.map((content, i) =>
    finalizeEvent({kind: 1, created_at: day - 50 + i, tags: [], content}, viewerKey)
  )
  const react = (key: Uint8Array, index: number, time: number, content: string) =>
    finalizeEvent(
      {
        kind: 7,
        content,
        created_at: time,
        tags: [
          ["e", posts[index].id],
          ["p", viewer],
        ],
      },
      key
    )
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [
      finalizeEvent(
        {
          kind: 3,
          created_at: day - 100,
          content: "",
          tags: [
            ["p", sender],
            ["p", getPublicKey(otherKey)],
          ],
        },
        viewerKey
      ),
      finalizeEvent(
        {
          kind: 0,
          created_at: day - 80,
          tags: [],
          content: JSON.stringify({name: "Rowan"}),
        },
        senderKey
      ),
      ...posts,
      ...posts.map((_, i) => react(senderKey, i, day + i, i % 2 ? "🌲" : "+")),
      react(senderKey, 4, day + 10, "🔥"),
      react(otherKey, 1, day + 15, "+"),
      react(senderKey, 0, day - 86400, "+"),
    ],
  })
  await page.addInitScript((port) => {
    window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
  }, relay.port)
  try {
    await signUp(page, nip19.nsecEncode(viewerKey))
    await page.locator('li a[href="/notifications"]').click()
    const feed = page.locator("#main-content")
    const group = feed.getByRole("article", {name: "Grouped reactions"})
    const toggle = group.getByRole("button", {name: "reacted to 10 posts"})
    await expect(toggle).toBeVisible({timeout: 20000})
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    const postRows = feed
      .locator("div.cursor-pointer.border-b:visible")
      .filter({hasText: "reacted"})
    await expect(postRows).toHaveCount(2)
    for (const post of posts.slice(0, 2)) {
      await expect(postRows.getByText(post.content, {exact: true})).toBeVisible()
    }
    await toggle.focus()
    await page.keyboard.press("Enter")
    const links = group.locator("ul a")
    await expect(links).toHaveCount(10)
    await expect(links.first()).toHaveAttribute(
      "href",
      "/" + nip19.noteEncode(posts[4].id)
    )
    for (const post of posts) {
      await expect(group.getByRole("link", {name: post.content})).toHaveAttribute(
        "href",
        "/" + nip19.noteEncode(post.id)
      )
    }
    await page.screenshot({path: testInfo.outputPath("grouped-reactions.png")})
    await group.getByRole("link", {name: posts[6].content}).click()
    await expect(page).toHaveURL(new RegExp(nip19.noteEncode(posts[6].id) + "$"))
    await expect(
      page
        .getByTestId("feed-item")
        .filter({hasText: posts[6].content, visible: true})
        .first()
    ).toBeVisible()
  } finally {
    await page.close()
    await relay.close()
  }
})
