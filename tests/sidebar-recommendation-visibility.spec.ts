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

test.skip(!usingLocalRelay, "requires deterministic local-relay sidebar data")

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

test("sidebar people recommendations hide a one-follow/one-mute candidate", async ({
  page,
}) => {
  test.setTimeout(120000)

  const viewer = createUser()
  const follower = createUser()
  const muter = createUser()
  const listOwner = createUser()
  const visibleControl = createUser()
  const overmutedCandidate = createUser()
  const unknownCandidate = createUser()
  const now = Math.floor(Date.now() / 1000)
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const controlName = `Visible Sidebar Control ${unique}`
  const hiddenName = `Hidden Sidebar Candidate ${unique}`
  const unknownName = `Unknown Sidebar Candidate ${unique}`

  await publishEvents([
    signEvent(viewer, {
      kind: 3,
      content: "",
      tags: [
        ["p", follower.publicKey],
        ["p", muter.publicKey],
      ],
      created_at: now - 6,
    }),
    signEvent(follower, {
      kind: 3,
      content: "",
      tags: [
        ["p", overmutedCandidate.publicKey],
        ["p", visibleControl.publicKey],
      ],
      created_at: now - 5,
    }),
    signEvent(muter, {
      kind: 10000,
      content: "",
      tags: [["p", overmutedCandidate.publicKey]],
      created_at: now - 4,
    }),
    // This explicit profile's sidebar supplies all candidates. The owner is
    // outside the viewer graph, so its follow list does not add another nearby
    // opinion to the exact one-follow/one-mute policy under test.
    signEvent(listOwner, {
      kind: 3,
      content: "",
      tags: [
        ["p", visibleControl.publicKey],
        ["p", overmutedCandidate.publicKey],
        ["p", unknownCandidate.publicKey],
      ],
      created_at: now - 3,
    }),
    signEvent(visibleControl, {
      kind: 0,
      content: JSON.stringify({name: controlName}),
      tags: [],
      created_at: now - 3,
    }),
    signEvent(overmutedCandidate, {
      kind: 0,
      content: JSON.stringify({name: hiddenName}),
      tags: [],
      created_at: now - 3,
    }),
    signEvent(unknownCandidate, {
      kind: 0,
      content: JSON.stringify({name: unknownName}),
      tags: [],
      created_at: now - 3,
    }),
  ])

  await signUp(page, nip19.nsecEncode(viewer.privateKey))
  await page.goto(`/${nip19.npubEncode(overmutedCandidate.publicKey)}`)

  // Prove the exact graph shape is hydrated before testing the sidebar: the
  // candidate has one nearby follower and one nearby muter, which is overmuted
  // at the shared threshold-three policy.
  await expect(page.getByText(/Muted by/)).toBeVisible({timeout: 30000})
  await expect(page.getByRole("img", {name: "warning"})).toBeVisible()

  await page.goto(`/${nip19.npubEncode(listOwner.publicKey)}`)

  const followsHeading = page.getByRole("heading", {name: "Follows"})
  await expect(followsHeading).toBeVisible({timeout: 30000})
  const followsWidget = followsHeading.locator("..")

  // The visible distance-two control proves the widget loaded real candidates. The
  // overmuted p-tag candidate must never be rendered alongside it.
  await expect(followsWidget.getByText(controlName, {exact: true})).toBeVisible({
    timeout: 30000,
  })
  await expect(followsWidget.getByText(hiddenName, {exact: true})).toHaveCount(0)
  await expect(followsWidget.getByText(unknownName, {exact: true})).toHaveCount(0)
})
