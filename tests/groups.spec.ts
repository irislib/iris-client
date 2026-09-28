import {test, expect, type Page} from "@playwright/test"
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  nip19,
  type Event,
} from "nostr-tools"
import WebSocket, {WebSocketServer} from "ws"
import {
  createGroupDraft,
  createMembershipDraft,
  createMembershipAttestationDraft,
  groupTags,
} from "../src/groups/model"
import {signUp} from "./auth.setup"
import {expectPersistedDraft} from "./utils/drafts"
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

for (const partial of [false, true]) {
  test(`group discovery can retry ${partial ? "partial" : "unavailable"} results`, async ({
    page,
  }, testInfo) => {
    const secret = generateSecretKey()
    const metadata = finalizeEvent(
      {
        ...createGroupDraft({
          creator: getPublicKey(secret),
          id: crypto.randomUUID(),
          name: "Our neighbourhood",
          description: "Ideas and conversations close to home.",
        }),
        created_at: Math.floor(Date.now() / 1000) - 1,
      },
      secret
    )
    let recovered = false
    // A real local socket also exercises the app's background relay worker.
    const relay = new WebSocketServer({host: "127.0.0.1", port: 0})
    await new Promise<void>((resolve) => relay.once("listening", resolve))
    relay.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const [type, id, ...filters] = JSON.parse(raw.toString())
        if (type !== "REQ") return
        const discovery = filters.some((filter) => filter.kinds?.includes(37368))
        if (discovery && (partial || recovered))
          socket.send(JSON.stringify(["EVENT", id, metadata]))
        if (!discovery || recovered) socket.send(JSON.stringify(["EOSE", id]))
      })
    })
    try {
      const address = relay.address()
      if (!address || typeof address === "string") throw new Error("Missing relay port")
      await prepare(page, address.port)
      await page.goto("/groups")
      const notice = page.getByRole("status").filter({
        hasText: partial ? "Some groups may be missing." : "Couldn’t load groups.",
      })
      await expect(notice).toBeVisible({timeout: 20000})
      await expect(page.getByText("Start something together", {exact: true})).toHaveCount(
        0
      )
      const group = page.getByRole("link", {name: /Our neighbourhood/})
      await expect(group).toHaveCount(partial ? 1 : 0)
      await page.setViewportSize({width: 390, height: 844})
      await page.screenshot({path: testInfo.outputPath("discovery-retry-mobile.png")})
      recovered = true
      await notice.getByRole("button", {name: "Try again"}).click()
      await expect(group).toBeVisible()
      await expect(notice).toHaveCount(0)
    } finally {
      await page.close()
      for (const socket of relay.clients) socket.terminate()
      await new Promise<void>((resolve) => relay.close(() => resolve()))
    }
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
  await expect(page.getByLabel("Trust view")).toHaveCount(0)
  await expect(page.getByLabel("Feed members")).toHaveCount(0)
  await expect(page.getByText(/Membership needs/)).toHaveCount(0)
  await page.getByRole("button", {name: "Group settings", exact: true}).click()
  const settings = page.getByRole("dialog")
  await expect(settings.getByLabel("Trust view")).toBeHidden()
  await settings.getByText("Advanced", {exact: true}).click()
  await expect(settings.getByLabel("Trust view")).toBeVisible()
  await settings.getByLabel("Trust view").selectOption("personal")
  await settings.getByRole("button", {name: "Done", exact: true}).click()
  await expect(page.getByRole("button", {name: "My network", exact: true})).toBeVisible()
  await page.getByRole("button", {name: "Group settings", exact: true}).click()
  await settings.getByText("Advanced", {exact: true}).click()
  await settings.getByLabel("Trust view").selectOption("creator")
  await settings.getByRole("button", {name: "Done", exact: true}).click()
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
  const composer = memberPage.getByPlaceholder(`Post to ${groupName}`)
  await composer.fill("A weekend assembly in the park?")
  await expectPersistedDraft(memberPage, "A weekend assembly in the park?")
  await composer.press("Meta+Enter")
  await expect(composer).toHaveValue("")
  await expectPersistedDraft(memberPage, "A weekend assembly in the park?", false)
  await memberPage.reload()
  await expect(composer).toHaveValue("")
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
  await expect(page.getByText("3 members", {exact: true})).toBeVisible({
    timeout: 15000,
  })
  await expect(
    memberPage.getByText("Unvouched spam should stay out", {exact: true})
  ).toHaveCount(0)
  await expect(memberPage.getByLabel("Feed members")).toHaveCount(0)

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
  await memberPage.getByRole("button", {name: "Group settings", exact: true}).click()
  await memberPage.getByRole("dialog").getByText("Advanced", {exact: true}).click()
  await memberPage.screenshot({path: testInfo.outputPath("group-settings-mobile.png")})
  await memberPage.getByRole("dialog").getByRole("button", {name: "Done"}).click()
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
    await composer.press("Meta+Enter")
    await expect(page.getByText(/Could not publish post/).first()).toBeVisible({
      timeout: 15000,
    })
    await expect(composer).toHaveValue("A proposal worth keeping")
    await expectPersistedDraft(page, "A proposal worth keeping")
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

test("a confirmed shortcut post clears a remounted editor and its saved draft", async ({
  page,
}) => {
  const secret = generateSecretKey()
  const group = {creator: getPublicKey(secret), id: crypto.randomUUID()}
  const metadata = finalizeEvent(
    {
      ...createGroupDraft({
        ...group,
        name: "Draft recovery",
        description: "A local check",
      }),
      created_at: Math.floor(Date.now() / 1000) - 1,
    },
    secret
  )
  let acknowledge: (() => void) | undefined
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [metadata],
    acknowledgeEvent: (event, accept) => {
      if (event.kind === 1) acknowledge = accept
      else accept()
    },
  })
  try {
    await prepare(page, relay.port)
    await signUp(page, nip19.nsecEncode(secret))
    await page.goto(`/groups/${group.creator}/${group.id}`)
    const composer = page.getByPlaceholder("Post to Draft recovery")
    const content = "A shortcut post should not remain a draft"
    await composer.fill(content)
    await expectPersistedDraft(page, content)
    await composer.press("Meta+Enter")
    await expect(page.getByTestId("feed-item").filter({hasText: content})).toHaveCount(1)
    await expect(composer).toHaveValue(content)
    await page.getByRole("tab", {name: "Polls", exact: true}).click()
    await page.getByRole("tab", {name: "Posts", exact: true}).click()
    await expect(composer).toHaveValue(content)
    expect(acknowledge).toBeDefined()
    acknowledge!()
    await expect(composer).toHaveValue("")
    await expectPersistedDraft(page, content, false)
    await page.reload()
    await expect(composer).toHaveValue("")

    // A late confirmation must not erase text written for the next post.
    await composer.fill("Another shortcut post")
    await composer.press("Control+Enter")
    await expect(
      page.getByTestId("feed-item").filter({hasText: "Another shortcut post"})
    ).toHaveCount(1)
    await composer.fill("My next draft")
    await expectPersistedDraft(page, "My next draft")
    acknowledge!()
    await expect(page.getByRole("button", {name: "Post", exact: true})).toBeEnabled()
    await expect(composer).toHaveValue("My next draft")
    await page.reload()
    await expect(composer).toHaveValue("My next draft")
  } finally {
    await page.close()
    await relay.close()
  }
})
