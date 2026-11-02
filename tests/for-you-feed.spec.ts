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
const usingLocalRelay =
  process.env.IRIS_E2E_LOCAL_RELAY === "true" || (!usingBuiltDist && !usingTestRelay)

test.skip(!usingLocalRelay, "requires deterministic local-relay recommendation data")

const LOCAL_RELAY = "ws://127.0.0.1:7777"
const DEFAULT_ROOT = "336f319763657d6b0e65a5b5876719e8c8dcdcf9396852be71ee26b73368b29b"

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
  test.skip(usingBuiltDist, "requires source-module access for controlled feed state")
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
  await page.route(/socialGraph[^/]*\.bin(?:\?.*)?$/, (route) => {
    // Vite first imports a JS module containing the asset URL, then fetches it.
    if (route.request().resourceType() === "script") return route.continue()
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
  ])
  await signUp(page, nip19.nsecEncode(viewer.privateKey))
  // Deliver feed posts after login so anonymous discovery cannot legitimately
  // mark the recommendation seen before this viewer's feed is mounted.
  await publishEvents([
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
  test.skip(usingBuiltDist, "requires source-module access for controlled feed state")
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
  await expect(page.getByText("No posts found for you")).toBeHidden()
  const content = `late relay recommendation ${viewer.publicKey}`
  await publishEvents([
    signEvent(followed, {kind: 1, content, tags: [], created_at: createdAt}),
  ])
  await expect(
    page.getByTestId("feed-item").filter({hasText: content}).first()
  ).toBeVisible({timeout: 3000})
})

test("a saved discovery graph without a contact event does not wait for silent relays", async ({
  page,
}, testInfo) => {
  test.skip(usingBuiltDist, "requires source-module access for controlled feed state")
  const viewer = createUser()
  const starter = createUser()
  const graph = new SocialGraph(DEFAULT_ROOT)
  graph.addFollower(DEFAULT_ROOT, starter.publicKey)
  await graph.recalculateFollowDistances()
  const snapshot = Array.from(await graph.toBinary())
  // No kind-3 event exists for this read-only viewer. Restore a completed
  // persisted snapshot, independently of the bundled discovery asset.
  await signUp(page, nip19.npubEncode(viewer.publicKey))
  await page.goto("/about")
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/stores/socialGraph.ts"
        return (await import(path)).useSocialGraphStore.getState().isReady
      })
    )
    .toBe(true)
  await page.evaluate(
    async ({snapshot, publicKey}) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("localforage")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction("keyvaluepairs", "readwrite")
          tx.objectStore("keyvaluepairs").put(
            {data: new Uint8Array(snapshot), readyRoot: publicKey},
            "socialGraph"
          )
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
        }
      })
    },
    {snapshot, publicKey: viewer.publicKey}
  )
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: ConstructorParameters<typeof Worker>[1]) {
        super(url, options)
        if (String(url).includes("relay-worker"))
          this.addEventListener("message", (event) => {
            if (event.data.type === "eose") event.stopImmediatePropagation()
          })
      }
    }
    const schedule = window.setTimeout.bind(window)
    window.setTimeout = ((callback, ms, ...args) =>
      // Hold the snapshot cutoff: rendering must use the saved snapshot rather
      // than merely beat a wall-clock performance threshold.
      schedule(
        ms === 8000 ? () => undefined : callback,
        ms,
        ...args
      )) as typeof window.setTimeout
  })
  const note = signEvent(starter, {
    kind: 1,
    content: `saved discovery ${viewer.publicKey}`,
    tags: [],
    created_at: Math.floor(Date.now() / 1000) - 60,
  })
  await publishEvents([note])
  const started = Date.now()
  await page.goto("/")
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/stores/socialGraph.ts"
        return (await import(path)).useSocialGraphStore.getState().isReady
      })
    )
    .toBe(true)
  await expect(
    page.getByTestId("feed-item").filter({hasText: note.content}).first()
  ).toBeVisible()
  console.log(`Saved discovery first post: ${Date.now() - started}ms`)
  await testInfo.attach("saved-discovery-first-post-ms", {
    body: String(Date.now() - started),
    contentType: "text/plain",
  })
  await page.screenshot({path: testInfo.outputPath("saved-discovery-ready.png")})
})

test("available chronological posts render while an earlier recommendation remains unavailable", async ({
  page,
}, testInfo) => {
  test.skip(usingBuiltDist, "requires source-module access for controlled feed state")
  const viewer = createUser()
  const followed = createUser()
  await publishEvents([
    signEvent(viewer, {kind: 3, content: "", tags: [["p", followed.publicKey]]}),
  ])
  await signUp(page, nip19.npubEncode(viewer.publicKey))
  await page.goto("/about")
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/stores/socialGraph.ts"
        return (await import(path)).useSocialGraphStore.getState().isReady
      })
    )
    .toBe(true)
  const unavailable = createUser().publicKey
  await publishEvents([
    signEvent(followed, {kind: 7, content: "+", tags: [["e", unavailable]]}),
  ])
  await page.addInitScript(() => {
    const schedule = window.setTimeout.bind(window)
    window.setTimeout = ((callback, ms, ...args) =>
      // Keep unavailable ID batches pending. Healthy, separately arriving
      // chronology must render without waiting for this timeout to release it.
      schedule(
        ms === 4000 ? () => undefined : callback,
        ms,
        ...args
      )) as typeof window.setTimeout
  })
  await page.goto("/")
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const path = "/src/utils/memcache.ts"
        const cache = (await import(path)).getOrCreateAlgorithmicFeedCache("for-you")
        return cache.reactionSubscription.showingReactionCounts?.has(id) ?? false
      }, unavailable)
    )
    .toBe(true)
  const note = signEvent(followed, {
    kind: 1,
    content: `healthy feed ${viewer.publicKey}`,
    tags: [],
    created_at: Math.floor(Date.now() / 1000) - 60,
  })
  const started = Date.now()
  await publishEvents([note])
  await expect(
    page
      .locator('#main-content [data-testid="feed-item"]')
      .filter({hasText: note.content})
      .first()
  ).toBeVisible()
  console.log(`Healthy source first post: ${Date.now() - started}ms`)
  await testInfo.attach("healthy-source-first-post-ms", {
    body: String(Date.now() - started),
    contentType: "text/plain",
  })
  await page.screenshot({path: testInfo.outputPath("healthy-source-ready.png")})
})

test("For You shows cached recommendations while other recommended posts are unavailable", async ({
  page,
}) => {
  test.skip(usingBuiltDist, "requires source-module access for controlled feed state")
  const viewer = createUser()
  const followed = createUser()
  // Deliver the five recommendation signals as one burst so the initial batch
  // contains both cached and unavailable IDs, rather than just its first event.
  await page.addInitScript((author) => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: ConstructorParameters<typeof Worker>[1]) {
        super(url, options)
        if (!String(url).includes("relay-worker")) return
        const pending = new Map<string, unknown[]>()
        const delivered = new Set<string>()
        let replaying = false
        this.addEventListener("message", (event) => {
          const data = event.data
          if (
            replaying ||
            data.type !== "event" ||
            data.event?.kind !== 7 ||
            data.event?.pubkey !== author ||
            delivered.has(data.subId)
          ) {
            return
          }
          event.stopImmediatePropagation()
          const batch = pending.get(data.subId) ?? []
          batch.push(data)
          pending.set(data.subId, batch)
          if (batch.length === 5) {
            delivered.add(data.subId)
            pending.delete(data.subId)
            queueMicrotask(() => {
              replaying = true
              for (const message of batch) {
                this.dispatchEvent(new MessageEvent("message", {data: message}))
              }
              replaying = false
            })
          }
        })
      }
    }
  }, followed.publicKey)
  await publishEvents([
    signEvent(viewer, {kind: 3, content: "", tags: [["p", followed.publicKey]]}),
  ])
  await signUp(page, nip19.nsecEncode(viewer.privateKey))
  await page.goto("/about")
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const modulePath = "/src/stores/socialGraph.ts"
        const {useSocialGraphStore} = await import(modulePath)
        return useSocialGraphStore.getState().isReady
      })
    )
    .toBe(true)

  const cachedPost = signEvent(followed, {
    kind: 1,
    content: `Cached recommendation ${viewer.publicKey}`,
    tags: [],
    created_at: Math.floor(Date.now() / 1000) - 5,
  })
  // This post was recently viewed, but is no longer available on a relay.
  // Keep it in the real hot cache without publishing it to the test relay.
  await page.evaluate(async (event) => {
    const cachePath = "/src/utils/eventCache.ts"
    const eventPath = "/src/lib/nostr/index.ts"
    const [{cacheEvent}, {AppEvent}] = await Promise.all([
      import(cachePath),
      import(eventPath),
    ])
    cacheEvent(new AppEvent(undefined, event))
  }, cachedPost)
  await publishEvents(
    [cachedPost.id, ...Array.from({length: 4}, () => createUser().publicKey)].map((id) =>
      signEvent(followed, {kind: 7, content: "+", tags: [["e", id]]})
    )
  )

  const startedAt = Date.now()
  await page.getByRole("link", {name: "Home", exact: true}).click()
  await expect(
    page.locator('#main-content [data-testid="feed-item"]').filter({
      hasText: cachedPost.content,
    })
  ).toBeVisible({timeout: 2500})
  expect(Date.now() - startedAt).toBeLessThan(2500)
})

test("For You separates prolific authors across pages and restores the same order", async ({
  page,
}, testInfo) => {
  const viewer = createUser()
  const authors = [createUser(), createUser(), createUser()]
  const now = Math.floor(Date.now() / 1000) - 60
  const notes = authors.flatMap((author, authorIndex) =>
    Array.from({length: 10}, (_, index) =>
      signEvent(author, {
        kind: 1,
        content: `Author ${authorIndex + 1} post ${index + 1}`,
        tags: [],
        created_at: now - authorIndex * 10 - index,
      })
    )
  )
  // Deliver the relay's initial history together, so all three authors are
  // available before the production feed chooses its first page.
  await page.addInitScript(
    (pubkeys) => {
      const NativeWorker = window.Worker
      window.Worker = class extends NativeWorker {
        constructor(
          url: string | URL,
          options?: ConstructorParameters<typeof Worker>[1]
        ) {
          super(url, options)
          if (!String(url).includes("relay-worker")) return
          const pending = new Map<string, unknown[]>()
          const delivered = new Set<string>()
          let replaying = false
          this.addEventListener("message", (event) => {
            const data = event.data
            if (
              replaying ||
              data.type !== "event" ||
              data.event?.kind !== 1 ||
              !pubkeys.includes(data.event?.pubkey) ||
              delivered.has(data.subId)
            )
              return
            event.stopImmediatePropagation()
            const batch = pending.get(data.subId) ?? []
            batch.push(data)
            pending.set(data.subId, batch)
            if (batch.length === 30) {
              delivered.add(data.subId)
              pending.delete(data.subId)
              queueMicrotask(() => {
                replaying = true
                for (const message of batch) {
                  this.dispatchEvent(new MessageEvent("message", {data: message}))
                }
                replaying = false
              })
            }
          })
        }
      }
    },
    authors.map((author) => author.publicKey)
  )
  await publishEvents([
    signEvent(viewer, {
      kind: 3,
      content: "",
      tags: authors.map((author) => ["p", author.publicKey]),
    }),
    ...notes,
  ])
  await signUp(page, nip19.nsecEncode(viewer.privateKey))
  const posts = page.locator('#main-content [data-testid="feed-item"]')
  const ids = () =>
    posts.evaluateAll((items) => items.map((item) => item.getAttribute("data-event-id")!))
  await expect.poll(() => posts.count()).toBeGreaterThanOrEqual(10)
  const initialIds = await ids()
  const authorById = new Map(notes.map((note) => [note.id, note.pubkey]))
  const assertDiverse = (orderedIds: string[]) => {
    expect(new Set(orderedIds).size).toBe(orderedIds.length)
    for (let i = 1; i < orderedIds.length; i++) {
      expect(authorById.get(orderedIds[i]), `adjacent posts ${i} and ${i + 1}`).not.toBe(
        authorById.get(orderedIds[i - 1])
      )
    }
  }
  assertDiverse(initialIds)
  await expect(async () => {
    await posts.last().scrollIntoViewIfNeeded()
    expect(await posts.count()).toBe(30)
  }).toPass({timeout: 15000})
  const allIds = await ids()
  expect(allIds.slice(0, initialIds.length)).toEqual(initialIds)
  expect([...allIds].sort()).toEqual(notes.map((note) => note.id).sort())
  assertDiverse(allIds)
  await posts.first().scrollIntoViewIfNeeded()
  await page.screenshot({path: testInfo.outputPath("diverse-for-you.png")})
  await page.getByRole("link", {name: "Settings", exact: true}).click()
  await page.getByRole("link", {name: "Home", exact: true}).click()
  await expect.poll(ids).toEqual(allIds)
})

test("For You defers a same-author burst until other authors arrive", async ({
  page,
}, testInfo) => {
  const viewer = createUser()
  const authors = Array.from({length: 4}, createUser)
  const now = Math.floor(Date.now() / 1000) - 60
  const notes = authors.slice(0, 2).flatMap((author, authorIndex) =>
    Array.from({length: authorIndex === 0 ? 4 : 3}, (_, index) =>
      signEvent(author, {
        kind: 1,
        content: `Burst author ${authorIndex + 1} post ${index + 1}`,
        tags: [],
        created_at: now - authorIndex * 10 - index,
      })
    )
  )
  await publishEvents([
    signEvent(viewer, {
      kind: 3,
      content: "",
      tags: authors.map((author) => ["p", author.publicKey]),
    }),
    ...notes.slice(0, 4),
  ])
  await signUp(page, nip19.nsecEncode(viewer.privateKey))
  const posts = page.locator('#main-content [data-testid="feed-item"]')
  const ids = () =>
    posts.evaluateAll((items) => items.map((item) => item.getAttribute("data-event-id")!))
  // Wait for the burst to reach the actual feed cache before asserting that
  // repeats were held back. A count of one alone could be an early partial read.
  if (!usingBuiltDist) {
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const path = "/src/utils/memcache.ts"
          const {getOrCreateAlgorithmicFeedCache} = await import(path)
          return getOrCreateAlgorithmicFeedCache("for-you").combinedPostFetcher.events
            ?.length
        })
      )
      .toBe(4)
  }
  await expect(posts).toHaveCount(1)
  const initialIds = await ids()
  if (!usingBuiltDist) {
    expect(
      await page.evaluate(
        async (postIds) => {
          const path = "/src/utils/memcache.ts"
          const {seenEventIds} = await import(path)
          return postIds.filter((id) => seenEventIds.has(id))
        },
        notes.slice(0, 4).map((note) => note.id)
      )
    ).toEqual(initialIds)
  }

  await page.locator('a[href="/u"]:visible').first().click()
  await expect(page).toHaveURL(/\/u$/)
  await page.locator('a[href="/"]:visible').first().click()
  await expect(page).toHaveURL(/\/$/)
  await expect.poll(ids).toEqual(initialIds)
  await publishEvents(notes.slice(4))
  await expect(async () => {
    await posts.last().scrollIntoViewIfNeeded()
    expect(await posts.count()).toBe(7)
  }).toPass({timeout: 15000})
  const allIds = await ids()
  expect(allIds.slice(0, initialIds.length)).toEqual(initialIds)
  expect([...allIds].sort()).toEqual(notes.map((note) => note.id).sort())
  const authorById = new Map(notes.map((note) => [note.id, note.pubkey]))
  for (let i = 1; i < allIds.length; i++) {
    expect(authorById.get(allIds[i])).not.toBe(authorById.get(allIds[i - 1]))
  }
  await posts.first().scrollIntoViewIfNeeded()
  await page.screenshot({path: testInfo.outputPath("delayed-author-for-you.png")})
  await page.locator('a[href="/u"]:visible').first().click()
  await expect(page).toHaveURL(/\/u$/)
  await page.locator('a[href="/"]:visible').first().click()
  await expect(page).toHaveURL(/\/$/)
  await expect.poll(ids).toEqual(allIds)
})

for (const {followCount, muteLast} of [
  {followCount: 1, muteLast: false},
  {followCount: 2, muteLast: false},
  {followCount: 3, muteLast: false},
  {followCount: 4, muteLast: true},
]) {
  test(`For You keeps quiet small networks readable with ${followCount} follows${muteLast ? " and one mute" : ""}`, async ({
    page,
  }) => {
    const viewer = createUser()
    const authors = Array.from({length: followCount}, createUser)
    const now = Math.floor(Date.now() / 1000) - 60
    const notes = Array.from({length: 14}, (_, index) =>
      signEvent(authors[0], {
        kind: 1,
        content: `Small network post ${index}`,
        tags: [],
        created_at: now - index,
      })
    )
    await publishEvents([
      signEvent(viewer, {
        kind: 3,
        content: "",
        tags: authors.map((author) => ["p", author.publicKey]),
      }),
      ...(muteLast
        ? [
            signEvent(viewer, {
              kind: 10000,
              content: "",
              tags: [["p", authors.at(-1)!.publicKey]],
            }),
          ]
        : []),
      ...notes,
    ])
    await signUp(page, nip19.nsecEncode(viewer.privateKey))
    const posts = page.locator('#main-content [data-testid="feed-item"]')
    await expect(posts.first()).toBeVisible()
    await expect(async () => {
      await posts.last().scrollIntoViewIfNeeded()
      expect(await posts.count()).toBe(notes.length)
    }).toPass({timeout: 10000})
  })
}

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

test("logged-in relay subscriptions survive page suspension and recover after worker crashes", async ({
  page,
}) => {
  test.skip(usingBuiltDist, "requires source-module access for controlled feed state")
  await page.clock.install()
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
    const modulePath = "/src/utils/nostrClient.ts"
    const {nostr} = await import(modulePath)
    const target = window as typeof window & {recoveredEvents: string[]}
    target.recoveredEvents = []
    nostr()
      .subscribe({kinds: [1], authors: [publicKey]})
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

  // As when waking a laptop, skip the suspended interval's timer callbacks.
  // The still-live worker must get a fresh ping before it is declared dead.
  await page.clock.fastForward(60_000)
  await page.clock.runFor(1500)
  expect(
    await page.evaluate(
      () => (window as typeof window & {relayWorkers: Worker[]}).relayWorkers.length
    )
  ).toBe(1)
  const resumed = `after suspension ${viewer.publicKey}`
  await publishEvents([signEvent(viewer, {kind: 1, content: resumed, tags: []})])
  await expect.poll(receivedEvents).toContain(resumed)

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
  test.skip(usingBuiltDist, "requires source-module access for controlled feed state")
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
