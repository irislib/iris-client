import {writeFile} from "node:fs/promises"
import {test, expect, type Page} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {Relay} from "nostr-tools/relay"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"

test("a conversational topic search finds technical posts and substantive replies", async ({
  page,
}, testInfo) => {
  const now = Math.floor(Date.now() / 1000) - 5
  const note = (content: string, age: number, tags: string[][] = []) =>
    finalizeEvent({kind: 1, content, tags, created_at: now - age}, generateSecretKey())
  const hardware = note(
    "I published the hardware schematic for a solar-powered sensor.",
    500
  )
  const reply = [["e", hardware.id, "", "reply"]]
  const useful = note(
    "I used a hardware timer to put the board to sleep between samples.",
    3,
    reply
  )
  const semantic = note(
    "A postcard-sized computer runs a local language model on its GPU.",
    10
  )
  const reactions = [
    note("Cool!", 1, reply),
    note("Wow, that's pretty cool!", 2),
    note("These posts are related.", 4),
  ]
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [hardware, useful, semantic, ...reactions],
  })
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
      localStorage.setItem(
        "search-storage",
        JSON.stringify({
          version: 1,
          state: {showEventsByUnknownUsers: true, searchModel: "minilm"},
        })
      )
    }, relay.port)
    await page.goto("/search/show%20me%20cool%20tech%20related%20posts")
    const rows = page.locator('#main-content [data-testid="feed-item"]:visible')
    for (const post of [hardware, useful, semantic])
      await expect(rows.filter({hasText: post.content})).toBeVisible({timeout: 12000})
    for (const post of reactions)
      await expect(rows.filter({hasText: post.content})).toHaveCount(0)
    await page.screenshot({path: testInfo.outputPath("tech-topic-search.png")})
    const input = page.getByRole("textbox", {name: "Search posts", exact: true})
    await input.fill("cool")
    await input.press("Enter")
    await expect(rows.filter({hasText: "Cool!"}).first()).toBeVisible()
  } finally {
    await relay.close()
  }
})

test("relay matches appear before GPU scoring, then a backlog and a lone arrival both get scored", async ({
  page,
  context,
}) => {
  const now = Math.floor(Date.now() / 1000)
  const note = (n: number, time: number) =>
    finalizeEvent(
      {
        kind: 1,
        content: `Binoculars for birdwatching model ${n}`,
        tags: [],
        created_at: time,
      },
      generateSecretKey()
    )
  const initial = Array.from({length: 32}, (_, i) => note(i, now - i - 5))
  const pendingEose: (() => void)[] = []
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: initial,
    endStoredEvents: (filters, finish) => {
      if (filters.some((filter) => filter.kinds?.includes(1))) pendingEose.push(finish)
      else finish()
    },
  })
  const batches: string[][] = []
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    // Control only inference readiness and capacity. The real relay, search
    // shortlist, display and worker client drive the scheduling in this test.
    await context.route(
      /\/semantic-search\.worker[^/]*(?:\.js|\.ts)(?:\?.*)?$/,
      (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: `
        self.onmessage = async ({data: {posts, request}}) => {
          if (!posts.length) await fetch("/test-mini-model-ready")
          else await fetch("/test-mini-batch", {method: "POST", body: JSON.stringify(posts)})
          self.postMessage({request, batchSize: 64, scores: posts.map(() => .85), ...(!posts.length && {terms: [], tags: []})})
        }`,
        })
    )
    await context.route("**/test-mini-model-ready", async (route) => {
      await ready
      await route.fulfill({body: "ready"}).catch(() => {})
    })
    await context.route("**/test-mini-batch", (route) => {
      batches.push(route.request().postDataJSON())
      return route.fulfill({body: "ok"})
    })
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
      localStorage.setItem(
        "search-storage",
        JSON.stringify({
          version: 1,
          state: {showEventsByUnknownUsers: true, searchModel: "minilm"},
        })
      )
    }, relay.port)
    await page.goto("/search/binoculars")
    await expect(page.getByText(initial[0].content, {exact: true}).first()).toBeVisible()
    expect(batches).toHaveLength(0)
    release()
    await expect.poll(() => batches.some((batch) => batch.length > 16)).toBe(true)
    const fresh = note(33, now)
    const writer = await Relay.connect(`ws://127.0.0.1:${relay.port}`)
    try {
      await writer.publish(fresh)
    } finally {
      writer.close()
    }
    await expect
      .poll(() =>
        batches.some((batch) => batch.length === 1 && batch[0].includes(fresh.content))
      )
      .toBe(true)
  } finally {
    release()
    pendingEose.forEach((finish) => finish())
    await relay.close()
  }
})

async function seedObservedTags(page: Page, tags: string[]) {
  await page.evaluate(async (tags) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("localforage")
      request.onupgradeneeded = () => request.result.createObjectStore("keyvaluepairs")
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction("keyvaluepairs", "readwrite")
        tx.objectStore("keyvaluepairs").put(tags, "market-tags")
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  }, tags)
}

test("Automatic adds one observed tag when the ordinary MiniLM planner has no terms", async ({
  page,
}, testInfo) => {
  const filters: string[][] = []
  const relay = await startNostrRelay({
    port: 0,
    onRequest: (requests) => {
      for (const f of requests) if (f.limit === 32 && f["#t"]) filters.push(f["#t"])
    },
  })
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
      Object.defineProperty(window, "LanguageModel", {
        configurable: true,
        value: undefined,
      })
    }, relay.port)
    await page.goto("/settings/content/search-model")
    await expect(page.getByRole("combobox", {name: "AI search model"})).toHaveValue(
      "auto"
    )
    await seedObservedTags(page, [
      "Birdwatching",
      "Crosswords",
      "DinnerParty",
      "DayTrading",
      "RollerSkating",
    ])
    const query =
      "A flash of blue near the river turned out to be a kingfisher sitting very still."
    await page.goto("/search/" + encodeURIComponent(query))
    await expect.poll(() => filters, {timeout: 15000}).toContainEqual(["Birdwatching"])
    expect(filters.flat()).not.toContain("DayTrading")
    await page.screenshot({path: testInfo.outputPath("learned-search-tag.png")})
  } finally {
    await relay.close()
  }
})

test("the local model searches previously seen and incoming hashtags in their original spelling", async ({
  page,
  context,
}) => {
  const seen = "FilmPhotography"
  const called: string[] = []
  const note = finalizeEvent(
    {
      kind: 1,
      content: "Trying a new photography technique.",
      tags: [["t", "Camera"]],
      created_at: Math.floor(Date.now() / 1000) - 10,
    },
    generateSecretKey()
  )
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [note],
    onRequest: (filters) => {
      for (const filter of filters) called.push(...(filter["#t"] ?? []))
    },
  })
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
      localStorage.setItem(
        "search-storage",
        JSON.stringify({
          version: 1,
          state: {showEventsByUnknownUsers: true, searchModel: "minilm"},
        })
      )
    }, relay.port)
    await page.goto("/search")
    await expect(
      page.getByRole("textbox", {name: "Search posts", exact: true})
    ).toBeVisible()
    // Seed the existing seen-tag list, just as a past visit to Market would.
    await seedObservedTags(page, [seen, "PepperSauce"])
    await context.route(
      /search-minilm-(?:q8|gpu)[^/]*\.onnx(?:\?.*)?$/,
      async (route) => {
        if (!new URL(route.request().url()).searchParams.has("url")) await gate
        await route.continue().catch(() => {})
      }
    )
    await page.goto("/search/photography")
    await expect(page.getByText(note.content, {exact: true}).first()).toBeVisible()
    release()
    await expect.poll(() => called, {timeout: 12000}).toContain(seen)
    await expect.poll(() => called).toContain("Camera")
    expect(called).not.toContain("PepperSauce")
  } finally {
    release()
    await relay.close()
  }
})

test("the result view follows submitted searches and survives a reload", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({width: 320, height: 780})
  await page.goto("/search/bicycle")
  const view = page.getByRole("button", {name: /^Show (all|AI selected)$/})
  await expect(page.getByRole("button", {name: "AI search", exact: true})).toHaveCount(0)
  await expect(view).toHaveText("Show all")
  const filters = page.getByRole("button", {name: "Filters", exact: true})
  const filterPosition = () =>
    filters.evaluate((button: HTMLElement) => [button.offsetLeft, button.offsetTop])
  const before = await filterPosition()
  await view.focus()
  await view.press("Enter")
  await expect(view).toHaveText("Show AI selected")
  expect(await filterPosition()).toEqual(before)
  await page.getByRole("textbox", {name: "Search posts", exact: true}).fill("garden")
  await page.getByRole("textbox", {name: "Search posts", exact: true}).press("Enter")
  await expect(page).toHaveURL(/search\/garden$/)
  await page.reload()
  await expect(view).toHaveText("Show AI selected")
  await expect(
    page.getByRole("textbox", {name: "Search posts", exact: true})
  ).toHaveValue("garden")
  await page.screenshot({path: testInfo.outputPath("result-view.png")})
  await page.getByRole("button", {name: "Filters"}).click()
  await page.getByRole("link", {name: "Search model settings"}).click()
  await expect(page.getByRole("combobox", {name: "AI search model"})).toBeFocused()
  await page.goBack()
  await view.click()
  await page.reload()
  await expect(view).toHaveText("Show all")
})

test("a feed remembers AI selection independently of search and other feeds", async ({
  page,
}, testInfo) => {
  const viewer = generateSecretKey()
  const author = generateSecretKey()
  const now = Math.floor(Date.now() / 1000) - 60
  const query = "protect plants from frost"
  const literal = "How to protect plants from frost overnight."
  const related = "The seedlings survived the cold night under an old sheet."
  const note = (text: string, key: Uint8Array) =>
    finalizeEvent({kind: 1, tags: [], content: text, created_at: now}, key)
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [
      finalizeEvent(
        {kind: 3, tags: [["p", getPublicKey(author)]], content: "", created_at: now},
        viewer
      ),
      note(literal, viewer),
      note(related, author),
    ],
  })
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
      if (!localStorage.getItem("search-storage"))
        localStorage.setItem(
          "search-storage",
          JSON.stringify({version: 1, state: {aiSearch: false, searchModel: "browser"}})
        )
      Object.defineProperty(window, "LanguageModel", {
        configurable: true,
        value: {
          availability: async () => "available",
          create: async () => ({
            destroy() {},
            async prompt(input: string) {
              const {posts} = JSON.parse(input)
              return JSON.stringify(
                posts.length ? {scores: posts.map(() => 95)} : {terms: []}
              )
            },
          }),
        },
      })
    }, relay.port)
    await signUp(page, nip19.nsecEncode(viewer))
    const main = page.locator("#main-content")
    await main.getByRole("button", {name: "Latest", exact: true}).click()
    await main.getByTitle("Edit feeds").click()
    const search = main.getByRole("textbox", {name: "Search", exact: true})
    await search.pressSequentially(query)
    await expect(search).toHaveValue(query)
    const ai = main.getByRole("button", {name: "Show AI selected", exact: true})
    const all = main.getByRole("button", {name: "Show all", exact: true})
    await ai.click()
    await page.reload()
    const posts = main.getByTestId("feed-item")
    await expect(posts.filter({hasText: related})).toBeVisible({timeout: 15000})
    await main.getByTitle("Edit feeds").click()
    await expect(search).toHaveValue(query)
    await expect(all).toBeVisible()
    await search.scrollIntoViewIfNeeded()
    await page.screenshot({path: testInfo.outputPath("feed-ai-filter.png")})
    await page.goto("/search/garden")
    await expect(ai).toBeVisible()
    await page.goto("/")
    await main.getByTitle("Edit feeds").click()
    await expect(all).toBeVisible()
    await main.getByRole("button", {name: "Articles", exact: true}).click()
    await expect(ai).toBeVisible()
    await expect(search).toHaveValue("")
    await main.getByRole("button", {name: "Latest", exact: true}).click()
    await all.click()
    await main.getByRole("button", {name: "Done", exact: true}).click()
    await expect(posts.filter({hasText: literal})).toBeVisible()
    await expect(posts.filter({hasText: related})).toHaveCount(0)
    await page.reload()
    await main.getByTitle("Edit feeds").click()
    await expect(ai).toBeVisible()
  } finally {
    await relay.close()
  }
})

test("automatic search falls back to on-device discovery when the browser returns unusable scores", async ({
  page,
}, testInfo) => {
  test.skip(
    !!process.env.VITE_USE_TEST_RELAY ||
      (usingBuiltDist && process.env.IRIS_E2E_LOCAL_RELAY !== "true"),
    "requires local relay"
  )
  await page.addInitScript(() => {
    Object.defineProperty(window, "LanguageModel", {
      configurable: true,
      value: {
        availability: async () => "available",
        create: async () => ({
          destroy() {},
          prompt: async (input: string) =>
            JSON.parse(input).posts.length ? '{"scores":[]}' : '{"terms":[]}',
        }),
      },
    })
  })
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
  const view = page.getByRole("button", {name: /^Show (all|AI selected)$/})
  await expect(view).toHaveText("Show all")
  const rows = page.locator('#main-content [data-testid="feed-item"]:visible')
  await expect(rows.first()).toContainText(target, {timeout: 30000})
  await page.screenshot({path: testInfo.outputPath("semantic-post-search.png")})
  await view.click()
  await expect(view).toHaveText("Show AI selected")
  await expect(rows.filter({hasText: target})).toHaveCount(0)
  await page.reload()
  await expect(view).toHaveText("Show AI selected")
  await view.click()
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
  let browserProbes = 0
  await page.exposeFunction("recordBrowserProbe", () => {
    browserProbes++
  })
  await page.addInitScript(() => {
    Object.defineProperty(window, "LanguageModel", {
      configurable: true,
      value: {
        availability: async () => {
          await (
            window as unknown as {recordBrowserProbe: () => Promise<void>}
          ).recordBrowserProbe()
          return new Promise(() => {})
        },
      },
    })
  })
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
  const input = page.getByRole("textbox", {name: "Search posts", exact: true})
  let releaseWeights!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseWeights = resolve
  })
  let downloads = 0
  await context.route(/search-minilm-(?:q8|gpu)[^/]*\.onnx(?:\?.*)?$/, async (route) => {
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
  const view = page.getByRole("button", {name: /^Show (all|AI selected)$/})
  try {
    await submit("bicycle")
    const first = await visibleTime(exact)
    await expect.poll(() => downloads, {timeout: 10000}).toBe(1)
    await expect(view).toHaveAttribute("aria-busy", "true")
    await input.fill("editing while the model loads")
    await expect(input).toHaveValue("editing while the model loads")
    await expect(page).toHaveURL(/search\/bicycle/)
    await input.fill("bicycle")
    const released = await page.evaluate(() => performance.now())
    releaseWeights()
    await expect(view).toHaveAttribute("aria-busy", "false")
    const cold = await page.evaluate(
      (start) => Math.round(performance.now() - start),
      released
    )
    await submit("how can I get my missing documents back after a drive failure")
    const warm = await visibleTime(semantic)
    await expect(view).toHaveAttribute("aria-busy", "false")
    expect(downloads).toBe(1)
    expect(browserProbes).toBe(1)
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
  let finishRequest!: () => void
  const pending = new Promise<void>((resolve) => {
    finishRequest = resolve
  })
  await page.route("http://127.0.0.1:11434/api/chat", async (route) => {
    await pending
    await route.fulfill({status: 404, body: "model not found"})
  })
  await page.setViewportSize({width: 320, height: 800})
  await page.goto("/search/seedlings", {waitUntil: "domcontentloaded"})
  const result = page.getByText(text, {exact: true})
  await expect(result).toBeVisible()
  await expect(page.getByText("Ranking posts…", {exact: true})).toBeVisible()
  const top = () => result.evaluate((el) => el.getBoundingClientRect().top)
  const before = await top()
  finishRequest()
  await expect(
    page.getByText("Ollama unavailable · using text and network relevance")
  ).toBeVisible()
  expect(Math.abs((await top()) - before)).toBeLessThan(1)
  await page.screenshot({path: testInfo.outputPath("unavailable-model-fallback.png")})
})

test("late browser scores preserve the reading position until Update results is pressed", async ({
  page,
}, testInfo) => {
  const viewer = generateSecretKey()
  const authors = Array.from({length: 15}, () => generateSecretKey())
  const now = Math.floor(Date.now() / 1000) - 30
  const target = "A motorized mount keeps the stars in frame all night."
  const note = (content: string, age: number, author: Uint8Array) =>
    finalizeEvent({kind: 1, content, tags: [], created_at: now - age}, author)
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [
      ...authors.map((author, i) =>
        note(`Telescope log ${i}. Observations from the garden.`, i, author)
      ),
      note(target, 20, authors[0]),
      finalizeEvent(
        {
          kind: 3,
          content: "",
          created_at: now,
          tags: authors.map((a) => ["p", getPublicKey(a)]),
        },
        viewer
      ),
    ],
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let started!: () => void
  const scoring = new Promise<void>((resolve) => {
    started = resolve
  })
  await page.exposeFunction("waitForBrowserScores", () => {
    started()
    return gate
  })
  await page.addInitScript((port) => {
    window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    // Upgrade the old persisted default exactly as an existing installation would.
    if (!localStorage.getItem("search-storage"))
      localStorage.setItem(
        "search-storage",
        JSON.stringify({version: 0, state: {searchModel: "minilm"}})
      )
    Object.defineProperty(window, "LanguageModel", {
      configurable: true,
      value: {
        availability: async () => "available",
        create: async () => ({
          destroy() {},
          async prompt(input: string) {
            const {posts} = JSON.parse(input)
            if (!posts.length) return '{"terms":[]}'
            await (
              window as unknown as {waitForBrowserScores: () => Promise<void>}
            ).waitForBrowserScores()
            return JSON.stringify({
              scores: posts.map((p: string) => (p.includes("motorized mount") ? 100 : 0)),
            })
          },
        }),
      },
    })
  }, relay.port)
  let bundledDownloads = 0
  page.on("request", (request) => {
    if (
      /search-minilm-(?:q8|gpu)[^/]*\.onnx$/.test(new URL(request.url()).pathname) &&
      !new URL(request.url()).searchParams.has("url")
    )
      bundledDownloads++
  })
  try {
    await signUp(page, nip19.nsecEncode(viewer))
    await page.goto("/search/telescope")
    const rows = page.locator('#main-content [data-testid="feed-item"]:visible')
    await expect(rows.nth(9)).toBeVisible()
    await rows.nth(8).scrollIntoViewIfNeeded()
    await expect(rows.nth(10)).toBeVisible()
    await scoring
    const anchor = await rows.nth(7).elementHandle()
    const top = () => anchor!.evaluate((el) => el.getBoundingClientRect().top)
    const beforeTop = await top()
    const ids = () =>
      rows.evaluateAll((items) => items.map((el) => el.getAttribute("data-event-id")))
    const before = await ids()
    release()
    await expect(
      page.getByRole("button", {name: /^Show (all|AI selected)$/})
    ).toHaveAttribute("aria-busy", "false")
    const update = page.getByRole("button", {name: "Update results", exact: true})
    await expect(update).toBeInViewport()
    expect((await ids()).slice(0, before.length)).toEqual(before)
    expect(Math.abs((await top()) - beforeTop)).toBeLessThan(2)
    await page.screenshot({path: testInfo.outputPath("stable-search-results.png")})
    await update.click()
    await expect(rows.first()).toContainText(target)
    await expect(rows.first()).toBeInViewport()
    await expect(update).toHaveCount(0)
    expect(bundledDownloads).toBe(0)
  } finally {
    release()
    await relay.close()
  }
})

test("returning to bare search shows progress and recent notes without rerunning the saved query", async ({
  page,
}, testInfo) => {
  const author = generateSecretKey()
  const root = "336f319763657d6b0e65a5b5876719e8c8dcdcf9396852be71ee26b73368b29b"
  const {SocialGraph} = await import("nostr-social-graph")
  const graph = new SocialGraph(root)
  const farther = generateSecretKey()
  graph.addFollower(root, getPublicKey(author))
  graph.addFollower(getPublicKey(author), getPublicKey(farther))
  await graph.recalculateFollowDistances()
  const snapshot = Buffer.from(await graph.toBinary())
  const note = finalizeEvent(
    {
      kind: 1,
      content: "Swallows returned to the river today.",
      tags: [],
      created_at: Math.floor(Date.now() / 1000) - 60,
    },
    author
  )
  const searches: string[] = []
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [
      note,
      finalizeEvent(
        {
          kind: 1,
          content: "Swallows over the marsh.",
          tags: [],
          created_at: note.created_at + 10,
        },
        farther
      ),
    ],
    onRequest: (filters) => {
      for (const f of filters) if (f.search) searches.push(f.search)
    },
  })
  let resume!: () => void
  const gate = new Promise<void>((resolve) => {
    resume = resolve
  })
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
      localStorage.setItem(
        "search-storage",
        JSON.stringify({version: 1, state: {searchQuery: "stale-history-probe"}})
      )
    }, relay.port)
    await page.route(/socialGraph[^/]*\.bin(?:\?.*)?$/, async (route) => {
      if (route.request().resourceType() === "script") return route.continue()
      await gate
      await route.fulfill({contentType: "application/octet-stream", body: snapshot})
    })
    await page.goto("/search")
    await expect(
      page.getByRole("textbox", {name: "Search posts", exact: true})
    ).toHaveValue("")
    const progress = page.getByRole("status").filter({hasText: "Loading your network"})
    await expect(progress).toBeInViewport()
    await page.screenshot({path: testInfo.outputPath("returning-search-progress.png")})
    resume()
    await expect(page.getByText(note.content, {exact: true}).first()).toBeVisible({
      timeout: 15000,
    })
    await expect(progress).toHaveCount(0)
    expect(searches).toEqual([])
    const input = page.getByRole("textbox", {name: "Search posts", exact: true})
    await input.fill("swallows")
    await input.press("Enter")
    const rows = page.locator('#main-content [data-testid="feed-item"]:visible')
    await expect(rows).toHaveCount(2)
    const sort = page.getByRole("combobox", {name: "Sort posts"})
    await sort.selectOption("newest")
    await expect(rows.first()).toContainText("over the marsh")
    await sort.selectOption("social")
    await expect(rows.first()).toContainText(note.content)
    await expect(
      page.getByRole("checkbox", {name: "Show posts from unknown users"})
    ).toHaveCount(0)
  } finally {
    resume()
    await relay.close()
  }
})

test("nature search keeps political media out of the grid and filters and sorts matching posts", async ({
  page,
}, testInfo) => {
  const now = Math.floor(Date.now() / 1000) - 60
  const note = (content: string, age: number, tags: string[][] = [], kind = 1) =>
    finalizeEvent({kind, content, created_at: now - age, tags}, generateSecretKey())
  const media = (name: string) => `https://example.com/${name}.jpg`
  const forest = note(
    "Cedar trees, red moss, and tiny mushrooms covered the forest floor after the rain. " +
      media("one") +
      " " +
      media("two"),
    80,
    [["t", "nature"]]
  )
  const orchid = note(
    "Wild orchids are flowering along the riverbank. Bees visit each blossom before moving to the next.",
    30
  )
  const reply = note("Nature walk this morning. I saw another otter.", 1, [
    ["e", forest.id, "", "reply"],
  ])
  const gallery = note(
    "",
    45,
    [
      [
        "imeta",
        "url " + media("gallery"),
        "m image/jpeg",
        "alt Nature photograph of a mountain lake.",
      ],
    ],
    20
  )
  const news = note(
    "The youngest victim was reportedly 14 years old. There is now great outrage and riots in the capital against the national guard. " +
      media("report"),
    2,
    [["client", "Nostrich"]]
  )
  const uncaptioned = note(
    "https://images.americanthinker.com/cr/crki4buignxltt0hbslg_640.jpg",
    4,
    [["client", "Nostrich"]]
  )
  const ads = note(
    "The parties reported their spending on political advertising. Weekly TikTok placements in Germany through September. " +
      Array.from({length: 12}, (_, i) => media("ads" + i)).join(" "),
    3
  )
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [forest, orchid, gallery, reply, news, ads, uncaptioned],
  })
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
      localStorage.setItem(
        "search-storage",
        JSON.stringify({
          version: 1,
          state: {searchModel: "minilm", showEventsByUnknownUsers: true},
        })
      )
    }, relay.port)
    await page.goto("/search/nature")
    const rows = page.locator('#main-content [data-testid="feed-item"]:visible')
    await expect(rows.filter({hasText: orchid.content})).toBeVisible({timeout: 20000})
    await expect(page.getByText("Ranking posts…", {exact: true})).toHaveCount(0, {
      timeout: 15000,
    })
    await expect(rows.filter({hasText: "youngest victim"})).toHaveCount(0)
    await expect(rows.filter({hasText: "political advertising"})).toHaveCount(0)
    await expect(page.locator(`[data-event-id="${uncaptioned.id}"]`)).toHaveCount(0)
    await page.getByRole("combobox", {name: "Sort posts"}).selectOption("newest")
    await expect(rows.first()).toContainText("Nature walk")
    await page.getByRole("button", {name: /^Filters/}).click()
    await page.getByLabel("Post type", {exact: true}).selectOption("originals")
    await expect(rows.filter({hasText: "Nature walk"})).toHaveCount(0)
    await page.getByLabel("With media", {exact: true}).check()
    await expect(rows.filter({hasText: orchid.content})).toHaveCount(0)
    await page.getByRole("button", {name: "Grid view"}).click()
    await expect(page.locator(`[data-search-media="${forest.id}"]`)).toHaveCount(1)
    await expect(page.locator(`[data-search-media="${gallery.id}"]`)).toHaveCount(1)
    await expect(page.getByLabel("2 attachments")).toBeVisible()
    await expect(page.locator(`[data-search-media="${uncaptioned.id}"]`)).toHaveCount(0)
    await page.getByRole("combobox", {name: "Sort posts"}).selectOption("social")
    await expect(page.locator("[data-search-media]")).toHaveCount(2)
    await page.screenshot({path: testInfo.outputPath("nature-grid-filters.png")})
  } finally {
    await relay.close()
  }
})
