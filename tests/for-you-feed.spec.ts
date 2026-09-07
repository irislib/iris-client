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
import {SocialGraph} from "nostr-social-graph"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"

const usingTestRelay =
  process.env.VITE_USE_TEST_RELAY === "true" || process.env.VITE_USE_TEST_RELAY === "1"
const usingLocalRelay = !usingBuiltDist && !usingTestRelay

test.skip(!usingLocalRelay, "requires deterministic local-relay recommendation data")

const LOCAL_RELAY = "ws://127.0.0.1:7777"
const DEFAULT_ROOT = "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0"

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

test("For You uses the default network until the viewer follows someone", async ({
  page,
}, testInfo) => {
  const viewer = createUser()
  const starter = createUser()
  const recommended = createUser()
  const muted = createUser()
  const personal = createUser()
  const graph = new SocialGraph(DEFAULT_ROOT)
  graph.addFollower(DEFAULT_ROOT, starter.publicKey)
  graph.addFollower(DEFAULT_ROOT, muted.publicKey)
  graph.addFollower(starter.publicKey, recommended.publicKey)
  await graph.recalculateFollowDistances()
  const snapshot = Buffer.from(await graph.toBinary())
  let snapshotRequests = 0
  await page.route(/socialGraph[^/]*\.bin(?:\?.*)?$/, (route) => {
    // Vite first imports a JS module containing the asset URL, then fetches it.
    if (route.request().resourceType() === "script") return route.continue()
    snapshotRequests++
    return route.fulfill({contentType: "application/octet-stream", body: snapshot})
  })

  const now = Math.floor(Date.now() / 1000) - 5
  const starterContent = `Starter network post ${viewer.publicKey}`
  const recommendedContent = `Starter recommendation ${viewer.publicKey}`
  const mutedContent = `Muted starter post ${viewer.publicKey}`
  const personalContent = `Personal network post ${viewer.publicKey}`
  const recommendedPost = signEvent(recommended, {
    kind: 1,
    content: recommendedContent,
    tags: [],
    created_at: now,
  })
  await publishEvents([
    signEvent(viewer, {kind: 3, content: "", tags: [], created_at: now}),
    signEvent(viewer, {
      kind: 10000,
      content: "",
      tags: [["p", muted.publicKey]],
      created_at: now,
    }),
    signEvent(starter, {kind: 1, content: starterContent, tags: [], created_at: now}),
    recommendedPost,
    signEvent(starter, {
      kind: 7,
      content: "+",
      tags: [["e", recommendedPost.id]],
      created_at: now,
    }),
    signEvent(muted, {kind: 1, content: mutedContent, tags: [], created_at: now}),
    signEvent(personal, {kind: 1, content: personalContent, tags: [], created_at: now}),
  ])
  await signUp(page, nip19.nsecEncode(viewer.privateKey))
  expect(snapshotRequests).toBe(1)

  const posts = page.locator('#main-content [data-testid="feed-item"]:visible')
  await expect(posts.filter({hasText: starterContent}).first()).toBeVisible({
    timeout: 15000,
  })
  await expect(posts.filter({hasText: recommendedContent}).first()).toBeVisible()
  await expect(posts.filter({hasText: mutedContent})).toHaveCount(0)
  await expect(posts.filter({hasText: personalContent})).toHaveCount(0)
  await expect(page.getByText("Follow someone to see content from them")).toBeHidden()
  expect(
    await page.evaluate(async () => {
      const modulePath = "/src/utils/socialGraph.ts"
      const {getSocialGraph} = await import(modulePath)
      const graph = getSocialGraph()
      return {
        root: graph.getRoot(),
        follows: [...graph.getFollowedByUser(graph.getRoot())],
      }
    })
  ).toEqual({root: viewer.publicKey, follows: []})
  await page.screenshot({path: testInfo.outputPath("starter-for-you.png")})

  // A follow-list update must switch the mounted feed without a page reload.
  await publishEvents([
    signEvent(viewer, {kind: 3, content: "", tags: [["p", personal.publicKey]]}),
  ])
  await expect(posts.filter({hasText: personalContent}).first()).toBeVisible({
    timeout: 10000,
  })
  await expect(posts.filter({hasText: starterContent})).toHaveCount(0)
  await expect(posts.filter({hasText: recommendedContent})).toHaveCount(0)
})

test("a restored low-activity for you feed displays relay posts without the five-second fallback", async ({
  page,
}, testInfo) => {
  const viewer = createUser()
  const followed = createUser()
  const content = `low-activity feed ${viewer.publicKey}`
  await publishEvents([
    signEvent(viewer, {kind: 3, content: "", tags: [["p", followed.publicKey]]}),
    signEvent(followed, {
      kind: 1,
      content,
      tags: [],
      created_at: Math.floor(Date.now() / 1000) - 1,
    }),
  ])
  await signUp(page, nip19.nsecEncode(viewer.privateKey))

  const startedAt = Date.now()
  await page.reload()
  try {
    await expect(
      page.getByTestId("feed-item").filter({hasText: content}).first()
    ).toBeVisible({timeout: 15000})
    console.log(`Restored For You feed: ${Date.now() - startedAt}ms`)
    expect(Date.now() - startedAt).toBeLessThan(4000)
  } finally {
    await testInfo.attach("restored-for-you-ms", {
      body: String(Date.now() - startedAt),
      contentType: "text/plain",
    })
  }
})

test("restored For You starts from its saved graph when relays never send EOSE", async ({
  page,
}, testInfo) => {
  const viewer = createUser()
  const followed = createUser()
  await publishEvents([
    signEvent(viewer, {kind: 3, content: "", tags: [["p", followed.publicKey]]}),
  ])
  await signUp(page, nip19.nsecEncode(viewer.privateKey))
  await page.goto("/settings/social-graph")
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const modulePath = "/src/stores/socialGraph.ts"
        const {useSocialGraphStore} = await import(modulePath)
        return useSocialGraphStore.getState().isReady
      })
    )
    .toBe(true)
  // Wait for the actual completed snapshot, including its viewer marker, to
  // reach disk before testing a returning visitor with silent relays.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string | undefined>((resolve, reject) => {
            const open = indexedDB.open("localforage")
            open.onerror = () => reject(open.error)
            open.onsuccess = () => {
              const db = open.result
              const tx = db.transaction("keyvaluepairs", "readonly")
              const request = tx.objectStore("keyvaluepairs").get("socialGraph")
              request.onsuccess = () => resolve(request.result?.readyRoot)
              request.onerror = () => reject(request.error)
              tx.oncomplete = () => db.close()
            }
          })
      )
    )
    .toBe(viewer.publicKey)
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: ConstructorParameters<typeof Worker>[1]) {
        super(url, options)
        if (String(url).includes("relay-worker")) {
          this.addEventListener("message", (event) => {
            if (event.data.type === "eose") event.stopImmediatePropagation()
          })
        }
      }
    }
  })
  const content = `no EOSE recommendation ${viewer.publicKey}`
  await publishEvents([
    signEvent(followed, {
      kind: 1,
      content,
      tags: [],
      created_at: Math.floor(Date.now() / 1000) - 1,
    }),
  ])
  const startedAt = Date.now()
  await page.goto("/")
  await expect(
    page.getByTestId("feed-item").filter({hasText: content}).first()
  ).toBeVisible({timeout: 4000})
  const elapsed = Date.now() - startedAt
  await testInfo.attach("saved-graph-no-eose-ms", {
    body: String(elapsed),
    contentType: "text/plain",
  })
  expect(elapsed).toBeLessThan(4000)
})

test("an empty For You feed displays late relay posts without another refresh", async ({
  page,
}) => {
  const viewer = createUser()
  const followed = createUser()
  const createdAt = Math.floor(Date.now() / 1000) - 60
  await publishEvents([
    signEvent(viewer, {kind: 3, content: "", tags: [["p", followed.publicKey]]}),
  ])
  await signUp(page, nip19.nsecEncode(viewer.privateKey))
  await expect(page.getByText("No posts found for you")).toBeVisible({timeout: 20000})
  const content = `late relay recommendation ${viewer.publicKey}`
  await publishEvents([
    signEvent(followed, {kind: 1, content, tags: [], created_at: createdAt}),
  ])
  await expect(
    page.getByTestId("feed-item").filter({hasText: content}).first()
  ).toBeVisible({timeout: 3000})
})

test("a short For You feed fills with late posts and keeps paginating", async ({
  page,
}) => {
  await page.setViewportSize({width: 1280, height: 1000})
  const viewer = createUser()
  const followed = createUser()
  const createdAt = Math.floor(Date.now() / 1000) - 60
  const content = `pagination ${viewer.publicKey}`
  await publishEvents([
    signEvent(viewer, {kind: 3, content: "", tags: [["p", followed.publicKey]]}),
    ...Array.from({length: 2}, (_, index) =>
      signEvent(followed, {
        kind: 1,
        content: `${content} initial ${index}`,
        tags: [],
        created_at: createdAt - index,
      })
    ),
  ])
  await signUp(page, nip19.nsecEncode(viewer.privateKey))
  const posts = page.getByTestId("feed-item").filter({hasText: content})
  await expect(posts).toHaveCount(2)
  const initialOrder = await posts.allTextContents()
  // Let the real browser deliver its initial intersection notification before
  // new relay candidates arrive at a feed whose end is already in view.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  )
  await publishEvents(
    Array.from({length: 30}, (_, index) =>
      signEvent(followed, {
        kind: 1,
        content: `${content} later ${index}`,
        tags: [],
        created_at: createdAt - index - 2,
      })
    )
  )
  await expect.poll(() => posts.count(), {timeout: 5000}).toBeGreaterThan(2)
  // Each appended batch must leave the existing posts in their original order.
  expect((await posts.allTextContents()).slice(0, 2)).toEqual(initialOrder)
  await expect(async () => {
    await posts.last().scrollIntoViewIfNeeded()
    expect(await posts.count()).toBe(32)
  }).toPass({timeout: 20000})
})

test("logged-in relay subscriptions recover after their worker crashes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const target = window as typeof window & {
      relayWorkers: Worker[]
      relayWorkersReady: number
    }
    target.relayWorkers = []
    target.relayWorkersReady = 0
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: ConstructorParameters<typeof Worker>[1]) {
        super(url, options)
        if (String(url).includes("relay-worker")) {
          target.relayWorkers.push(this)
          this.addEventListener("message", ({data}) => {
            if (data.type === "ready") target.relayWorkersReady++
          })
        }
      }
    }
  })
  const viewer = createUser()
  const before = `before recovery ${viewer.publicKey}`
  const after = `after recovery ${viewer.publicKey}`
  await signUp(page, nip19.nsecEncode(viewer.privateKey))
  // Use a stable app subscription: UI pagination can otherwise replace a feed
  // subscription during recovery and conceal the dropped-subscription bug.
  await page.evaluate(async (publicKey) => {
    const modulePath = "/src/utils/ndk.ts"
    const {ndk} = await import(modulePath)
    const target = window as typeof window & {recoveredEvents: string[]}
    target.recoveredEvents = []
    ndk()
      .subscribe({kinds: [1], authors: [publicKey]}, {transports: ["worker-transport"]})
      .on("event", (event: {content: string}) => {
        target.recoveredEvents.push(event.content)
      })
  }, viewer.publicKey)
  await publishEvents([signEvent(viewer, {kind: 1, content: before, tags: []})])
  const receivedEvents = () =>
    page.evaluate(
      () => (window as typeof window & {recoveredEvents: string[]}).recoveredEvents
    )
  await expect.poll(receivedEvents).toContain(before)

  await page.evaluate(() => {
    const target = window as typeof window & {relayWorkers: Worker[]}
    const worker = target.relayWorkers[0]
    worker.terminate()
    worker.dispatchEvent(new ErrorEvent("error", {message: "test worker crash"}))
  })
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & {relayWorkersReady: number}).relayWorkersReady
      )
    )
    .toBe(2)
  await publishEvents([signEvent(viewer, {kind: 1, content: after, tags: []})])
  await expect.poll(receivedEvents).toContain(after)
})

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
