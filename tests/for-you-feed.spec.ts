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

test.skip(!usingLocalRelay, "requires deterministic local-relay recommendation data")

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
    for (const event of events) {
      await relay.publish(event)
    }
  } finally {
    relay.close()
  }
}

test("for you filters overmuted authors and unknown engagement actors", async ({
  page,
}) => {
  test.setTimeout(120000)

  const viewer = createUser()
  const recommender = createUser()
  const visibleReposter = createUser()
  const muter = createUser()
  const overmutedAuthor = createUser()
  const controlAuthor = createUser()
  const repostControlAuthor = createUser()
  const unknownReactionTargetAuthor = createUser()
  const unknownRepostTargetAuthor = createUser()
  const unknownReactionActor = createUser()
  const unknownRepostActor = createUser()
  const now = Math.floor(Date.now() / 1000)

  await publishEvents([
    signEvent(viewer, {
      kind: 3,
      content: "",
      tags: [
        ["p", recommender.publicKey],
        ["p", visibleReposter.publicKey],
        ["p", muter.publicKey],
      ],
      created_at: now - 4,
    }),
    signEvent(recommender, {
      kind: 3,
      content: "",
      tags: [
        ["p", overmutedAuthor.publicKey],
        ["p", controlAuthor.publicKey],
        ["p", unknownReactionTargetAuthor.publicKey],
        ["p", unknownRepostTargetAuthor.publicKey],
      ],
      created_at: now - 3,
    }),
    signEvent(visibleReposter, {
      kind: 3,
      content: "",
      tags: [["p", repostControlAuthor.publicKey]],
      created_at: now - 3,
    }),
    signEvent(muter, {
      kind: 10000,
      content: "",
      tags: [["p", overmutedAuthor.publicKey]],
      created_at: now - 2,
    }),
  ])

  await signUp(page, nip19.nsecEncode(viewer.privateKey))
  await page.goto(`/${nip19.npubEncode(overmutedAuthor.publicKey)}`)

  // This is the exact trust-graph shape from the regression: one known user
  // follows the author and one known user mutes them. The profile and feeds use
  // threshold 3, so the warning proves the author must be excluded from For You.
  await expect(page.getByText(/Muted by/)).toBeVisible({timeout: 30000})
  await expect(page.getByRole("img", {name: "warning"})).toBeVisible()

  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  // Keep recommendation events safely inside the subscription's inclusive
  // `until: now` window even when graph hydration completes within one second.
  const recommendationTime = Math.floor(Date.now() / 1000) - 1
  const hiddenContent = `overmuted recommendation ${unique}`
  const reactionControlContent = `visible reaction recommendation ${unique}`
  const repostControlContent = `visible repost recommendation ${unique}`
  const unknownReactionContent = `unknown reaction actor recommendation ${unique}`
  const unknownRepostContent = `unknown repost actor recommendation ${unique}`
  const hiddenNote = signEvent(overmutedAuthor, {
    kind: 1,
    content: hiddenContent,
    tags: [],
    created_at: recommendationTime,
  })
  const controlNote = signEvent(controlAuthor, {
    kind: 1,
    content: reactionControlContent,
    tags: [],
    created_at: recommendationTime,
  })
  const repostControlNote = signEvent(repostControlAuthor, {
    kind: 1,
    content: repostControlContent,
    tags: [],
    created_at: recommendationTime,
  })
  const unknownReactionNote = signEvent(unknownReactionTargetAuthor, {
    kind: 1,
    content: unknownReactionContent,
    tags: [],
    created_at: recommendationTime,
  })
  const unknownRepostNote = signEvent(unknownRepostTargetAuthor, {
    kind: 1,
    content: unknownRepostContent,
    tags: [],
    created_at: recommendationTime,
  })

  await publishEvents([
    hiddenNote,
    controlNote,
    repostControlNote,
    unknownReactionNote,
    unknownRepostNote,
    signEvent(recommender, {
      kind: 7,
      content: "+",
      tags: [["e", hiddenNote.id]],
      created_at: recommendationTime,
    }),
    signEvent(recommender, {
      kind: 7,
      content: "+",
      tags: [["e", controlNote.id]],
      created_at: recommendationTime,
    }),
    signEvent(visibleReposter, {
      kind: 6,
      content: repostControlNote.content,
      tags: [["e", repostControlNote.id]],
      created_at: recommendationTime,
    }),
    signEvent(unknownReactionActor, {
      kind: 7,
      content: "+",
      tags: [["e", unknownReactionNote.id]],
      created_at: recommendationTime,
    }),
    signEvent(unknownRepostActor, {
      kind: 6,
      content: unknownRepostNote.content,
      tags: [["e", unknownRepostNote.id]],
      created_at: recommendationTime,
    }),
  ])

  await page.goto("/")

  // The controls prove both real signal -> candidate -> post fetch paths ran;
  // absence alone could otherwise be a relay timing false positive.
  const visibleFeedItems = page.locator('[data-testid="feed-item"]:visible')
  await expect(
    visibleFeedItems.filter({hasText: reactionControlContent}).first()
  ).toBeVisible({timeout: 30000})
  await expect(
    visibleFeedItems.filter({hasText: repostControlContent}).first()
  ).toBeVisible()
  await expect(visibleFeedItems.filter({hasText: hiddenContent})).toHaveCount(0)
  await expect(visibleFeedItems.filter({hasText: unknownReactionContent})).toHaveCount(0)
  await expect(visibleFeedItems.filter({hasText: unknownRepostContent})).toHaveCount(0)
})
