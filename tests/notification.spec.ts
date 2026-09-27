import {test, expect} from "@playwright/test"
import {nip19} from "nostr-tools"
import {signUp} from "./auth.setup"

test("user sees a highlighted notification when a followed user likes their post", async ({
  browser,
}) => {
  test.setTimeout(90000)
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
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
  }
})
