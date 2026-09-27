import {test, expect, type Page} from "@playwright/test"
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  nip19,
  type Event,
} from "nostr-tools"
import WebSocket from "ws"
import {
  createGroupDraft,
  createMembershipDraft,
  createMembershipAttestationDraft,
  groupTags,
} from "../src/groups/model"
import {signUp} from "./auth.setup"
import {startNostrRelay} from "../dev-relay/nostr-relay"

async function prepare(page: Page, port = 7777) {
  await page.addInitScript((port) => {
    window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
  }, port)
}

async function publish(event: Event) {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket("ws://127.0.0.1:7777")
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error("Relay did not acknowledge fixture"))
    }, 10000)
    socket.on("open", () => socket.send(JSON.stringify(["EVENT", event])))
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString())
      if (message[0] !== "OK" || message[1] !== event.id) return
      clearTimeout(timeout)
      socket.close()
      message[2] ? resolve() : reject(new Error(message[3]))
    })
    socket.on("error", reject)
  })
}

test("group creation, membership, posts, polls and direct links preserve access", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000)
  const creatorKey = generateSecretKey()
  const memberKey = generateSecretKey()
  const outsiderKey = generateSecretKey()
  const creator = getPublicKey(creatorKey)
  const member = getPublicKey(memberKey)
  await prepare(page)
  await signUp(page, nip19.nsecEncode(creatorKey))
  await page.goto("/groups")
  await page.getByRole("button", {name: "Create group", exact: true}).first().click()
  const create = page.getByRole("form", {name: "Create group"})
  const groupName = `Local assembly ${Date.now()}`
  await create.getByLabel("Name", {exact: true}).fill(groupName)
  await create
    .getByLabel("About & membership")
    .fill("A public place to discuss our town. Local residents are welcome.")
  await create.getByRole("button", {name: "Create group", exact: true}).click()
  await expect(page).toHaveURL(new RegExp(`/groups/${creator}/`), {timeout: 20000})
  await expect(page.getByText("You’re a member", {exact: true})).toBeVisible({
    timeout: 20000,
  })
  const url = page.url()
  const group = {creator, id: new URL(url).pathname.split("/").pop()!}

  const memberContext = await browser.newContext()
  const memberPage = await memberContext.newPage()
  await prepare(memberPage)
  await signUp(memberPage, nip19.nsecEncode(memberKey))
  await memberPage.goto(url)
  await memberPage.getByRole("button", {name: "Request to join"}).click()
  await expect(
    memberPage.getByText("Awaiting membership confirmation", {exact: true})
  ).toBeVisible({timeout: 15000})
  await expect(memberPage.getByPlaceholder(`Post to ${groupName}`)).toHaveCount(0)
  await page.getByRole("tab", {name: /^members$/i}).click()
  const memberRow = page.locator(`[data-testid="group-member"][data-pubkey="${member}"]`)
  await expect(memberRow).toBeVisible()
  await memberRow.getByRole("button", {name: "Confirm membership", exact: true}).click()
  await expect(memberPage.getByText("You’re a member", {exact: true})).toBeVisible({
    timeout: 15000,
  })

  // A trusted member is explicitly followed; admission alone cannot mint voting authority.
  await publish(
    finalizeEvent(
      {
        kind: 3,
        content: "",
        tags: [["p", member]],
        created_at: Math.floor(Date.now() / 1000),
      },
      creatorKey
    )
  )
  await memberPage
    .getByPlaceholder(`Post to ${groupName}`)
    .fill("A weekend assembly in the park?")
  await memberPage.getByRole("button", {name: "Post", exact: true}).click()
  await expect(memberPage).toHaveURL(url)
  const post = memberPage
    .getByTestId("feed-item")
    .filter({hasText: "A weekend assembly in the park?"})
    .first()
  await expect(post).toBeVisible({timeout: 15000})
  const postId = await post.getAttribute("data-event-id")

  const now = Math.floor(Date.now() / 1000)
  await publish(
    finalizeEvent(
      {...createMembershipDraft(group, getPublicKey(outsiderKey), true), created_at: now},
      outsiderKey
    )
  )
  await publish(
    finalizeEvent(
      {
        kind: 1,
        content: "Unvouched spam should stay out",
        tags: groupTags(group),
        created_at: now,
      },
      outsiderKey
    )
  )
  await publish(
    finalizeEvent(
      {
        kind: 7,
        content: "+",
        tags: [...groupTags(group), ["e", postId!], ["p", member]],
        created_at: now,
      },
      outsiderKey
    )
  )
  await expect(
    memberPage.getByText("Unvouched spam should stay out", {exact: true})
  ).toHaveCount(0)
  await expect(post.getByTestId("like-count")).not.toHaveText("1")
  await post.getByTestId("like-button").click()
  await expect(post.getByTestId("like-count")).toHaveText("1", {timeout: 15000})

  // A compromised trusted account can admit another account, but cannot delegate a trusted vote.
  await publish(
    finalizeEvent(
      {
        ...createMembershipAttestationDraft(group, getPublicKey(outsiderKey), true),
        created_at: Math.floor(Date.now() / 1000),
      },
      memberKey
    )
  )
  await expect(page.getByText("3 members in this view", {exact: true})).toBeVisible({
    timeout: 15000,
  })
  await expect(
    memberPage.getByText("Unvouched spam should stay out", {exact: true})
  ).toHaveCount(0)
  await memberPage.getByLabel("Feed members").selectOption("members")
  await expect(
    memberPage.getByText("Unvouched spam should stay out", {exact: true})
  ).toBeVisible({timeout: 15000})
  await memberPage.getByLabel("Feed members").selectOption("trusted")
  await expect(
    memberPage.getByText("Unvouched spam should stay out", {exact: true})
  ).toHaveCount(0)

  await page.getByRole("tab", {name: /^polls$/i}).click()
  await page.getByRole("button", {name: "Create poll", exact: true}).click()
  const poll = page.getByRole("form", {name: "Create poll"})
  await poll.getByLabel("Poll question").fill("Where should we meet?")
  await poll.getByLabel("Choice 1").fill("The park")
  await poll.getByLabel("Choice 2").fill("The library")
  await poll.getByRole("button", {name: "Post poll"}).click()
  await expect(poll).toHaveCount(0, {timeout: 15000})
  await expect(
    page.getByTestId("feed-item").filter({hasText: "Where should we meet?"}).first()
  ).toBeVisible({
    timeout: 15000,
  })
  await memberPage.getByRole("tab", {name: /^polls$/i}).click()
  await memberPage.getByRole("radio", {name: /The park/}).click()
  await memberPage.getByRole("button", {name: "Vote", exact: true}).click()
  await expect(memberPage.getByText("Vote confirmed", {exact: true}).first()).toBeVisible(
    {timeout: 15000}
  )

  const pollItem = memberPage
    .getByTestId("feed-item")
    .filter({hasText: "Where should we meet?"})
    .first()
  const pollId = (await pollItem.getAttribute("data-event-id"))!
  const parkId = await pollItem.getByRole("radio", {name: /The park/}).inputValue()
  await publish(
    finalizeEvent(
      {
        kind: 1018,
        content: "",
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", pollId],
          ["response", parkId],
        ],
      },
      outsiderKey
    )
  )
  await expect(
    pollItem.getByRole("button", {name: "Member ballots · 2", exact: true})
  ).toBeVisible({timeout: 15000})
  await expect(
    pollItem.getByRole("button", {name: "Trusted votes · 1", exact: true})
  ).toBeVisible()

  // Removing a voter from today's trust list must not rewrite the already-open poll.
  await publish(
    finalizeEvent(
      {
        kind: 3,
        content: "",
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      },
      creatorKey
    )
  )
  await memberPage.reload()
  await memberPage.getByRole("tab", {name: /^polls$/i}).click()
  await expect(
    pollItem.getByRole("button", {name: "Trusted votes · 1", exact: true})
  ).toBeVisible({timeout: 15000})
  await pollItem.getByRole("radio", {name: /The library/}).click()
  await pollItem.getByRole("button", {name: "Update vote", exact: true}).click()
  await expect(pollItem.getByText("Vote confirmed", {exact: true})).toBeVisible({
    timeout: 15000,
  })
  await expect(
    pollItem.getByRole("button", {name: "Trusted votes · 1", exact: true})
  ).toBeVisible()

  await memberPage.goto(`${new URL(url).origin}/${nip19.noteEncode(postId!)}`)
  const reply = memberPage.getByPlaceholder("Write your reply...")
  await reply.fill("I can help organise it.")
  await memberPage.getByRole("button", {name: "Reply", exact: true}).last().click()
  await expect(
    memberPage.getByText("I can help organise it.", {exact: true}).first()
  ).toBeVisible({timeout: 15000})

  // More than one page of member replies remains reachable through shared Iris rendering.
  for (let index = 0; index < 12; index++) {
    await publish(
      finalizeEvent(
        {
          kind: 1,
          content: `Assembly reply ${index + 1}`,
          tags: [...groupTags(group), ["e", postId!, "", "root"], ["p", member]],
          created_at: Math.floor(Date.now() / 1000),
        },
        memberKey
      )
    )
  }
  await memberPage
    .locator("[data-main-scroll-container]")
    .last()
    .evaluate((element) => element.scrollTo(0, element.scrollHeight))
  await expect(
    memberPage.getByText("Assembly reply 12", {exact: true}).first()
  ).toBeVisible({timeout: 15000})
  await memberPage.goto(url)

  // A deep link must enforce the same policy as the group page.
  const visitor = await browser.newPage()
  await prepare(visitor)
  await visitor.goto(`${new URL(url).origin}/${nip19.noteEncode(postId!)}`)
  await expect(
    visitor.getByText("A weekend assembly in the park?", {exact: true}).first()
  ).toBeVisible({timeout: 15000})
  await expect(visitor.getByTestId("like-button").first()).toBeDisabled()
  await expect(visitor.getByPlaceholder("Write your reply...")).toHaveCount(0)

  await publish(
    finalizeEvent(
      {
        kind: 3,
        content: "",
        tags: [["p", member]],
        created_at: Math.floor(Date.now() / 1000),
      },
      creatorKey
    )
  )
  await memberPage.setViewportSize({width: 390, height: 844})
  await memberPage.getByRole("tab", {name: /^posts$/i}).click()
  await expect(
    memberPage.getByRole("heading", {name: groupName, exact: true})
  ).toBeVisible()
  await expect
    .poll(() =>
      memberPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    )
    .toBe(true)
  await memberPage
    .locator("[data-main-scroll-container]")
    .evaluate((element) => element.scrollTo(0, 0))
  await memberPage.screenshot({
    path: testInfo.outputPath("groups-mobile.png"),
    fullPage: true,
  })
  await page.setViewportSize({width: 1440, height: 1000})
  await page.screenshot({path: testInfo.outputPath("groups-desktop.png"), fullPage: true})
  await memberPage.reload()
  await expect(memberPage.getByText("You’re a member", {exact: true})).toBeVisible({
    timeout: 15000,
  })
  await visitor.close()
  await memberContext.close()
})

test("a rejected group post keeps its draft and does not appear as confirmed", async ({
  page,
}) => {
  const secret = generateSecretKey()
  const group = {creator: getPublicKey(secret), id: crypto.randomUUID()}
  const metadata = finalizeEvent(
    {
      ...createGroupDraft({
        ...group,
        name: "Relay recovery",
        description: "A local recovery check",
      }),
      created_at: Math.floor(Date.now() / 1000) - 1,
    },
    secret
  )
  let rejectPosts = true
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [metadata],
    rejectEvent: (event) =>
      rejectPosts && event.kind === 1 ? "blocked: test relay policy" : undefined,
  })
  try {
    await prepare(page, relay.port)
    await signUp(page, nip19.nsecEncode(secret))
    await page.goto(`/groups/${group.creator}/${group.id}`)
    const composer = page.getByPlaceholder("Post to Relay recovery")
    await composer.fill("A proposal worth keeping")
    await page.getByRole("button", {name: "Post", exact: true}).click()
    await expect(page.getByText(/Could not publish post/).first()).toBeVisible({
      timeout: 15000,
    })
    await expect(composer).toHaveValue("A proposal worth keeping")
    await expect(
      page.getByTestId("feed-item").filter({hasText: "A proposal worth keeping"})
    ).toHaveCount(0)
    rejectPosts = false
    await page.getByRole("button", {name: "Post", exact: true}).click()
    await expect(
      page.getByTestId("feed-item").filter({hasText: "A proposal worth keeping"})
    ).toHaveCount(1, {timeout: 15000})
    await expect(composer).toHaveValue("")
  } finally {
    await page.close()
    await relay.close()
  }
})
