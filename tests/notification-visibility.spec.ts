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
