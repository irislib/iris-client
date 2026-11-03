import {writeFile} from "node:fs/promises"
import {test, expect} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {Relay} from "nostr-tools/relay"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"

test.describe("search sparkle", () => {
  test.use({hasTouch: true, viewport: {width: 390, height: 780}})

  test("a touch hold opens the model picker without toggling AI search", async ({
    page,
    context,
  }, testInfo) => {
    await page.goto("/search/bicycle")
    const sparkle = page.getByRole("button", {name: "AI search", exact: true})
    await sparkle.tap()
    await expect(sparkle).toHaveAttribute("aria-pressed", "false")
    const box = (await sparkle.boundingBox())!
    const touch = await context.newCDPSession(page)
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{x: box.x + box.width / 2, y: box.y + box.height / 2}],
    })
    const model = page.getByRole("combobox", {name: "AI search model"})
    await expect(model).toBeFocused()
    await touch.send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []})
    await expect(model).toBeFocused()
    await expect(model).toBeInViewport()
    await page.screenshot({path: testInfo.outputPath("sparkle-model-picker.png")})
    await model.selectOption("browser")
    await page.goBack()
    await expect(page.getByPlaceholder("Search posts...")).toHaveValue("bicycle")
    await expect(sparkle).toHaveAttribute("aria-pressed", "false")
    await sparkle.tap()
    await expect(sparkle).toHaveAttribute("aria-pressed", "true")
    await sparkle.press("ContextMenu")
    await expect(model).toBeFocused()
    await expect(model).toHaveValue("browser")
  })
})

test("the search sparkle supports mouse and keyboard options gestures", async ({
  page,
}) => {
  await page.goto("/search")
  const sparkle = page.getByRole("button", {name: "AI search", exact: true})
  const model = page.getByRole("combobox", {name: "AI search model"})
  await expect(sparkle).toBeVisible()
  const box = (await sparkle.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 60, y)
  // Wait beyond the hold threshold to verify a drag cancels the gesture.
  await page.waitForTimeout(600)
  await page.mouse.up()
  await expect(sparkle).toHaveAttribute("aria-pressed", "true")
  await page.mouse.move(x, y)
  await page.mouse.down()
  await expect(model).toBeFocused()
  await page.mouse.up()
  await page.goBack()
  await sparkle.click({button: "right"})
  await expect(model).toBeFocused()
  await page.goBack()
  await sparkle.press("Shift+F10")
  await expect(model).toBeFocused()
  await page.goBack()
  await expect(sparkle).toHaveAttribute("aria-pressed", "true")
  await sparkle.press("Space")
  await expect(sparkle).toHaveAttribute("aria-pressed", "false")
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
