import {writeFile} from "node:fs/promises"
import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {Relay} from "nostr-tools/relay"
import {SocialGraph} from "nostr-social-graph"
import {usingBuiltDist} from "./utils/built-dist"

test("can search for content", async ({page}) => {
  await signUp(page)

  const searchInput = page.getByPlaceholder("Search")
  await searchInput.fill("bitcoin")
  await searchInput.press("Enter")

  // Wait for navigation to complete
  await expect(page).toHaveURL(/\/search/, {timeout: 10000})
})

test("search uses the starter network and does not skip between recent and old matches", async ({
  page,
}, testInfo) => {
  test.skip(usingBuiltDist || !!process.env.VITE_USE_TEST_RELAY, "requires local relay")
  const viewer = generateSecretKey()
  const authors = Array.from({length: 3}, () => generateSecretKey())
  const oldAuthors = Array.from({length: 12}, () => generateSecretKey())
  const author = authors[0]
  const stranger = generateSecretKey()
  const muted = generateSecretKey()
  const root = "336f319763657d6b0e65a5b5876719e8c8dcdcf9396852be71ee26b73368b29b"
  const graph = new SocialGraph(root)
  for (const key of [...authors, ...oldAuthors])
    graph.addFollower(root, getPublicKey(key))
  graph.addFollower(root, getPublicKey(muted))
  await graph.recalculateFollowDistances()
  const snapshot = Buffer.from(await graph.toBinary())
  await page.route(/socialGraph[^/]*\.bin(?:\?.*)?$/, (route) =>
    route.request().resourceType() === "script"
      ? route.continue()
      : route.fulfill({contentType: "application/octet-stream", body: snapshot})
  )
  const query = `iris${getPublicKey(viewer).slice(0, 12)}`
  const now = Math.floor(Date.now() / 1000) - 10
  const day = 86400
  const relay = await Relay.connect("ws://127.0.0.1:7777")
  const publish = (
    key: Uint8Array,
    content: string,
    created_at: number,
    tags: string[][] = [],
    kind = 1
  ) => relay.publish(finalizeEvent({kind, content, tags, created_at}, key))
  try {
    await publish(viewer, "", now, [], 3)
    await publish(viewer, "", now, [["p", getPublicKey(muted)]], 10000)
    await publish(author, `${query} recent July match`, now - 40 * day)
    // More than one relay page of nonmatches must not prevent looking further back.
    for (let i = 0; i < 120; i++)
      await publish(author, `unrelated ${i}`, now - 41 * day - i)
    await publish(authors[1], `${query} middle June match`, now - 90 * day)
    await publish(authors[2], `${query} old February match`, now - 210 * day, [
      ["t", query],
    ])
    // A full screen of old hashtag matches must not stop the newer text scan.
    for (const key of oldAuthors) {
      await publish(key, `${query} old indexed match`, now - 211 * day, [["t", query]])
    }
    await publish(stranger, `${query} unknown match`, now - 42 * day, [["t", query]])
    await publish(muted, `${query} muted match`, now - 42 * day, [["t", query]])
  } finally {
    relay.close()
  }
  await signUp(page, nip19.nsecEncode(viewer))
  await page.goto(`/search/${query}`)
  const posts = page.locator('#main-content [data-testid="feed-item"]:visible')
  await expect(posts.filter({hasText: "recent July match"})).toBeVisible({timeout: 15000})
  await expect(posts.filter({hasText: "middle June match"})).toBeVisible({timeout: 15000})
  await expect(posts.filter({hasText: "old February match"})).toBeVisible()
  await expect(posts.filter({hasText: "unknown match"})).toHaveCount(0)
  await expect(posts.filter({hasText: "muted match"})).toHaveCount(0)
  // Background graph updates used to clear the entire mounted search.
  const firstRow = await posts.first().elementHandle()
  await page.evaluate(async () => {
    const modulePath = "/src/stores/socialGraph.ts"
    const {useSocialGraphStore} = await import(modulePath)
    useSocialGraphStore.getState().incrementVersion()
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
  })
  expect(await firstRow!.evaluate((element) => element.isConnected)).toBe(true)
  await page.getByRole("checkbox", {name: "Show posts from unknown users"}).check()
  await expect(posts.filter({hasText: "unknown match"})).toBeVisible({timeout: 15000})
  await expect(posts.filter({hasText: "muted match"})).toHaveCount(0)
  await page.screenshot({path: testInfo.outputPath("search-results.png")})
})

test("post search matches whole words and collapses repeated authors across pages", async ({
  page,
}, testInfo) => {
  test.skip(usingBuiltDist || !!process.env.VITE_USE_TEST_RELAY, "requires local relay")
  const viewer = generateSecretKey()
  const prolific = generateSecretKey()
  const other = generateSecretKey()
  const nonmatch = generateSecretKey()
  const token = `search${getPublicKey(viewer).slice(0, 12)}`
  const now = Math.floor(Date.now() / 1000) - 10
  const relay = await Relay.connect("ws://127.0.0.1:7777")
  const publish = (
    key: Uint8Array,
    content: string,
    age: number,
    tags: string[][] = []
  ) => relay.publish(finalizeEvent({kind: 1, content, tags, created_at: now - age}, key))
  try {
    await relay.publish(
      finalizeEvent({kind: 3, content: "", tags: [], created_at: now}, viewer)
    )
    await publish(prolific, `${token} IRIS! newest match`, 0)
    for (let i = 1; i <= 120; i++) {
      await publish(prolific, `${token} iris repeated match ${i}`, i)
    }
    await publish(other, `${token} iris.to another author`, 121)
    await publish(nonmatch, `${token} Irish substring only`, 1, [["t", "iris"]])
  } finally {
    relay.close()
  }
  await signUp(page, nip19.nsecEncode(viewer))
  await page.goto(`/search/${encodeURIComponent(`iris ${token}`)}`)
  await page.getByRole("button", {name: "AI search"}).click()
  await page.getByRole("checkbox", {name: "Show posts from unknown users"}).check()
  const posts = page.locator('#main-content [data-testid="feed-item"]:visible')
  await expect(posts.filter({hasText: "newest match"})).toBeVisible({timeout: 15000})
  await expect(posts.filter({hasText: "another author"})).toBeVisible({timeout: 15000})
  await expect(posts.filter({hasText: "substring only"})).toHaveCount(0)
  await expect(posts.filter({hasText: "repeated match"})).toHaveCount(0)
  await expect(posts).toHaveCount(2)
  await page.getByRole("button", {name: "Show 120 more from this author"}).click()
  await expect(
    page.getByText(`${token} iris repeated match 120`, {exact: true})
  ).toBeVisible()
  await expect(posts.filter({hasText: "repeated match"})).toHaveCount(120)
  await page.screenshot({path: testInfo.outputPath("expanded-author-search.png")})
  await page.getByRole("button", {name: "Hide additional posts"}).click()
  await expect(posts.filter({hasText: "repeated match"})).toHaveCount(0)
  await expect(posts.filter({hasText: "another author"})).toBeVisible()
  await page.screenshot({path: testInfo.outputPath("distinct-author-search.png")})
})

test("an empty search can continue past several pages of nonmatches", async ({page}) => {
  test.skip(usingBuiltDist || !!process.env.VITE_USE_TEST_RELAY, "requires local relay")
  const viewer = generateSecretKey()
  const query = `iris${getPublicKey(viewer).slice(0, 12)}`
  const now = Math.floor(Date.now() / 1000) - 5
  const relay = await Relay.connect("ws://127.0.0.1:7777")
  try {
    for (let i = 0; i < 320; i++) {
      await relay.publish(
        finalizeEvent(
          {kind: 1, content: `nonmatch ${i}`, created_at: now - i, tags: []},
          viewer
        )
      )
    }
    await relay.publish(
      finalizeEvent(
        {kind: 1, content: `${query} older match`, created_at: now - 321, tags: []},
        viewer
      )
    )
  } finally {
    relay.close()
  }
  await signUp(page, nip19.nsecEncode(viewer))
  await page.goto(`/search/${query}`)
  await page.getByRole("button", {name: "AI search"}).click()
  await expect(page.getByText("No matching posts found")).toBeVisible({timeout: 15000})
  await page.getByRole("button", {name: "Search older posts"}).click()
  await expect(
    page
      .locator('#main-content [data-testid="feed-item"]')
      .filter({hasText: `${query} older match`})
  ).toBeVisible({timeout: 15000})
})

test("on-device relevance discovers older paraphrases through a related relay term", async ({
  page,
}, testInfo) => {
  test.skip(
    !!process.env.VITE_USE_TEST_RELAY ||
      (usingBuiltDist && process.env.IRIS_E2E_LOCAL_RELAY !== "true"),
    "requires local relay"
  )
  const viewer = generateSecretKey()
  const now = Math.floor(Date.now() / 1000) - 10
  const relay = await Relay.connect("ws://127.0.0.1:7777")
  const target =
    "My new bike is perfect for cycling to work. The frame and tires make the commute so much easier."
  const post = (content: string, age: number, tags: string[][] = []) =>
    relay.publish(finalizeEvent({kind: 1, content, tags, created_at: now - age}, viewer))
  try {
    await post(target, 1000, [["t", "bike"]])
    for (let i = 0; i < 310; i++)
      await post(`The soup is ready for dinner. Serving ${i}.`, i)
  } finally {
    relay.close()
  }
  await signUp(page, nip19.nsecEncode(viewer))
  await page.goto("/search/bicycle")
  const toggle = page.getByRole("button", {name: "AI search"})
  await expect(toggle).toHaveAttribute("aria-pressed", "true")
  const rows = page.locator('#main-content [data-testid="feed-item"]:visible')
  await expect(rows.first()).toContainText(target, {timeout: 30000})
  await page.screenshot({path: testInfo.outputPath("semantic-post-search.png")})
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-pressed", "false")
  await expect(rows.filter({hasText: target})).toHaveCount(0)
  await page.reload()
  await expect(toggle).toHaveAttribute("aria-pressed", "false")
  await toggle.click()
  await expect(rows.first()).toContainText(target, {timeout: 30000})
})

test("text results stay interactive during a cold model load and subsequent searches reuse it", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    !!process.env.VITE_USE_TEST_RELAY ||
      (usingBuiltDist && process.env.IRIS_E2E_LOCAL_RELAY !== "true"),
    "requires local relay"
  )
  const viewer = generateSecretKey(),
    neighbor = generateSecretKey(),
    now = Math.floor(Date.now() / 1000) - 5
  const relay = await Relay.connect("ws://127.0.0.1:7777")
  const exact = "Bicycle maintenance day. I cleaned the chain."
  const semantic =
    "Recover lost data from a broken disk by restoring your encrypted backup onto a new hard drive."
  try {
    await relay.publish(
      finalizeEvent(
        {kind: 3, content: "", tags: [["p", getPublicKey(neighbor)]], created_at: now},
        viewer
      )
    )
    for (let i = 0; i < 64; i++)
      await relay.publish(
        finalizeEvent(
          {
            kind: 1,
            content: `Today's lunch was delicious. Table ${i}.`,
            tags: [],
            created_at: now - i - 2,
          },
          neighbor
        )
      )
    await relay.publish(
      finalizeEvent({kind: 1, content: exact, tags: [], created_at: now}, neighbor)
    )
    await relay.publish(
      finalizeEvent({kind: 1, content: semantic, tags: [], created_at: now - 1}, viewer)
    )
  } finally {
    relay.close()
  }
  await signUp(page, nip19.nsecEncode(viewer))
  await page.goto("/search")
  const input = page.getByPlaceholder("Search posts...")
  let releaseWeights!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseWeights = resolve
  })
  let downloads = 0
  await context.route(/search-minilm-q8[^/]*\.onnx(?:\?.*)?$/, async (route) => {
    if (new URL(route.request().url()).searchParams.has("url")) return route.continue()
    downloads++
    await gate
    await route.continue().catch(() => {})
  })
  // Use the same page clock for timing and observe the first painted result.
  const submit = async (query: string) => {
    await input.fill(query)
    await input.evaluate((el) =>
      el.addEventListener("keydown", () => performance.mark("search-submitted"), {
        once: true,
      })
    )
    await input.press("Enter")
  }
  const visibleTime = async (text: string) => {
    await page.waitForFunction(
      (text) =>
        Array.from(
          document.querySelectorAll('#main-content [data-testid="feed-item"]')
        ).some((el) => el.checkVisibility() && el.textContent?.includes(text)),
      text,
      {timeout: 10000}
    )
    return page.evaluate(() =>
      Math.round(
        performance.now() -
          performance.getEntriesByName("search-submitted").at(-1)!.startTime
      )
    )
  }
  const toggle = page.getByRole("button", {name: "AI search"})
  try {
    await submit("bicycle")
    const first = await visibleTime(exact)
    await expect.poll(() => downloads).toBe(1)
    await expect(toggle).toHaveAttribute("aria-busy", "true")
    await input.fill("editing while the model loads")
    await expect(input).toHaveValue("editing while the model loads")
    await expect(page).toHaveURL(/search\/bicycle/)
    await input.fill("bicycle")
    const released = await page.evaluate(() => performance.now())
    releaseWeights()
    await expect(toggle).toHaveAttribute("aria-busy", "false")
    const cold = await page.evaluate(
      (start) => Math.round(performance.now() - start),
      released
    )
    await submit("how can I get my missing documents back after a drive failure")
    const warm = await visibleTime(semantic)
    await expect(toggle).toHaveAttribute("aria-busy", "false")
    expect(downloads).toBe(1)
    const path = testInfo.outputPath("search-timings.json")
    await writeFile(
      path,
      JSON.stringify(
        {
          firstTextMs: first,
          coldRankingAfterDownloadUnblockedMs: cold,
          warmSemanticMs: warm,
        },
        null,
        2
      )
    )
    await testInfo.attach("search-timings.json", {path, contentType: "application/json"})
  } finally {
    releaseWeights()
  }
})

test("a selected browser model can rank paraphrases and an unavailable provider preserves text results", async ({
  page,
}, testInfo) => {
  test.skip(
    !!process.env.VITE_USE_TEST_RELAY ||
      (usingBuiltDist && process.env.IRIS_E2E_LOCAL_RELAY !== "true"),
    "requires local relay"
  )
  const viewer = generateSecretKey()
  const text = "The seedlings survived the cold night under an old sheet."
  const query = "how to protect plants from frost"
  const relay = await Relay.connect("ws://127.0.0.1:7777")
  try {
    await relay.publish(
      finalizeEvent(
        {kind: 1, content: text, tags: [], created_at: Math.floor(Date.now() / 1000) - 1},
        viewer
      )
    )
  } finally {
    relay.close()
  }
  await page.addInitScript(() => {
    Object.defineProperty(window, "LanguageModel", {
      configurable: true,
      value: {
        availability: async () => "available",
        create: async () => ({
          destroy() {},
          async prompt(input: string) {
            const {posts} = JSON.parse(input)
            return posts.length
              ? JSON.stringify({
                  scores: posts.map((s: string) => (s.includes("seedlings") ? 95 : 0)),
                })
              : '{"terms":["seedlings"]}'
          },
        }),
      },
    })
  })
  await signUp(page, nip19.nsecEncode(viewer))
  await page.goto("/settings/content")
  await page.getByLabel("AI search model").selectOption("browser")
  await page.goto(`/search/${encodeURIComponent(query)}`)
  await expect(page.getByText(text, {exact: true})).toBeVisible()
  await page.goto("/settings/content")
  await page.getByLabel("AI search model").selectOption("ollama")
  await page.getByRole("textbox", {name: "Ollama model"}).fill("unavailable-test-model")
  await page.route("http://127.0.0.1:11434/api/chat", (r) =>
    r.fulfill({status: 404, body: "model not found"})
  )
  await page.goto("/search/seedlings")
  await expect(page.getByText(text, {exact: true})).toBeVisible()
  await expect(
    page.getByText("Ollama unavailable · using text and network relevance")
  ).toBeVisible()
  await page.screenshot({path: testInfo.outputPath("unavailable-model-fallback.png")})
})
