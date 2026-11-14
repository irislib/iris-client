import {expect, test} from "@playwright/test"
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  type EventTemplate,
  type VerifiedEvent,
} from "nostr-tools"
import {Relay} from "nostr-tools/relay"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"

const usingTestRelay =
  process.env.VITE_USE_TEST_RELAY === "true" || process.env.VITE_USE_TEST_RELAY === "1"
const usingLocalRelay = !usingBuiltDist && !usingTestRelay

test.skip(!usingLocalRelay, "requires deterministic local-relay notification data")

const LOCAL_RELAY = "ws://127.0.0.1:7777"

interface TestUser {
  privateKey: Uint8Array
  publicKey: string
}

const createUser = (): TestUser => {
  const privateKey = generateSecretKey()
  return {privateKey, publicKey: getPublicKey(privateKey)}
}

const signEvent = (
  user: TestUser,
  event: Omit<EventTemplate, "created_at"> & {created_at?: number}
): VerifiedEvent =>
  finalizeEvent(
    {
      ...event,
      created_at: event.created_at ?? Math.floor(Date.now() / 1000),
    },
    user.privateKey
  )

const publishEvents = async (events: VerifiedEvent[]) => {
  const relay = await Relay.connect(LOCAL_RELAY)
  try {
    for (const event of events) await relay.publish(event)
  } finally {
    relay.close()
  }
}

test("notifications reject an overmuted reply while preserving a followed reply", async ({
  page,
}) => {
  test.setTimeout(120000)

  const viewer = createUser()
  const follower = createUser()
  const muter = createUser()
  const control = createUser()
  const overmutedAuthor = createUser()
  const now = Math.floor(Date.now() / 1000)

  await publishEvents([
    signEvent(viewer, {
      kind: 3,
      content: "",
      tags: [
        ["p", follower.publicKey],
        ["p", muter.publicKey],
        ["p", control.publicKey],
      ],
      created_at: now - 5,
    }),
    signEvent(follower, {
      kind: 3,
      content: "",
      tags: [["p", overmutedAuthor.publicKey]],
      created_at: now - 4,
    }),
    signEvent(muter, {
      kind: 10000,
      content: "",
      tags: [["p", overmutedAuthor.publicKey]],
      created_at: now - 3,
    }),
  ])

  await signUp(page, nip19.nsecEncode(viewer.privateKey))
  await page.goto(`/${nip19.npubEncode(overmutedAuthor.publicKey)}`)

  // This proves the exact one-follow/one-mute policy snapshot is hydrated.
  await expect(page.getByText(/Muted by/)).toBeVisible({timeout: 30000})
  await expect(page.getByRole("img", {name: "warning"})).toBeVisible()

  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const hiddenContent = `hidden notification reply ${unique}`
  const controlContent = `visible notification reply ${unique}`
  const eventTime = Math.floor(Date.now() / 1000) - 1
  const hiddenTarget = signEvent(viewer, {
    kind: 1,
    content: `hidden reply target ${unique}`,
    tags: [],
    created_at: eventTime - 1,
  })
  const controlTarget = signEvent(viewer, {
    kind: 1,
    content: `control reply target ${unique}`,
    tags: [],
    created_at: eventTime - 1,
  })

  await publishEvents([
    hiddenTarget,
    controlTarget,
    signEvent(overmutedAuthor, {
      kind: 1,
      content: hiddenContent,
      tags: [
        ["e", hiddenTarget.id, "", "reply"],
        ["p", viewer.publicKey],
      ],
      created_at: eventTime,
    }),
    signEvent(control, {
      kind: 1,
      content: controlContent,
      tags: [
        ["e", controlTarget.id, "", "reply"],
        ["p", viewer.publicKey],
      ],
      created_at: eventTime,
    }),
  ])

  await page.goto("/notifications")

  // The control proves graph hydration, relay history, and rendering all ran.
  await expect(page.getByText(controlContent)).toBeVisible({timeout: 30000})
  await expect(page.getByText(hiddenContent)).toHaveCount(0)
})

test("opening a post reads only its activity and later reactions are still unread", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000)
  const viewer = createUser()
  const sender = createUser()
  const now = Math.floor(Date.now() / 1000) - 5
  const post = (name: string) =>
    signEvent(viewer, {kind: 1, content: name, tags: [], created_at: now - 2})
  const first = post("First post " + viewer.publicKey.slice(0, 8))
  const second = post("Second post " + viewer.publicKey.slice(0, 8))
  const reaction = (target: VerifiedEvent, created_at: number) =>
    signEvent(sender, {
      kind: 7,
      content: "+",
      tags: [
        ["e", target.id],
        ["p", viewer.publicKey],
      ],
      created_at,
    })
  await publishEvents([
    signEvent(viewer, {kind: 3, content: "", tags: [["p", sender.publicKey]]}),
    first,
    second,
    reaction(second, now - 1),
    reaction(first, now),
  ])

  await signUp(page, nip19.nsecEncode(viewer.privateKey))
  const badge = page.locator('li a[href="/notifications"] .indicator-item')
  await expect(badge).toBeVisible({timeout: 20000})
  await page.goto("/" + nip19.neventEncode({id: first.id}))
  await expect(page.getByText(first.content, {exact: true}).first()).toBeVisible()
  await expect(badge).toBeVisible({timeout: 20000})

  await page.locator('li a[href="/notifications"]').click()
  const group = page.getByRole("article", {name: "Grouped reactions"})
  await group.getByRole("button", {name: "reacted to 2 posts"}).click()
  const row = (content: string) => group.getByRole("listitem").filter({hasText: content})
  await expect(row(first.content)).toBeVisible()
  await expect(row(second.content).getByLabel("Unread")).toBeVisible()
  await expect(row(first.content).getByLabel("Unread")).toHaveCount(0)
  await page.screenshot({path: testInfo.outputPath("selectively-read.png")})
  await expect(badge).toBeHidden()

  // Keep the notification subscription active while leaving the inbox. A
  // settings view cannot mark new activity on our first post read.
  await page.locator('li a[href="/settings"]').click()
  await expect(page).toHaveURL(/\/settings$/)
  const seenAt = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("notifications-storage")!).state
        .notificationsSeenAt as number
  )
  await expect.poll(() => Math.floor(Date.now() / 1000)).toBeGreaterThan(seenAt)
  await publishEvents([reaction(first, Math.floor(Date.now() / 1000))])
  await expect(badge).toBeVisible({timeout: 20000})
  const detail = await page.context().newPage()
  await detail.goto("/" + nip19.noteEncode(first.id))
  await expect(detail.getByText(first.content, {exact: true}).first()).toBeVisible()
  // The original tab is still subscribed. Its badge clearing proves that the
  // detail read took effect, even if the detail loaded before relay history.
  await expect(badge).toBeHidden({timeout: 15000})
  await detail.screenshot({path: testInfo.outputPath("post-read.png")})
})
