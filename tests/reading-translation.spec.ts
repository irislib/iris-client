import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {Relay} from "nostr-tools/relay"
import {signUp} from "./auth.setup"
import {ensureCurrentDeviceRegistered} from "./private-messaging-helpers"
import type {usePrivateMessagesStore} from "../src/stores/privateMessages"
import {usingBuiltDist} from "./utils/built-dist"

test.skip(
  usingBuiltDist && process.env.IRIS_E2E_LOCAL_RELAY !== "true",
  "uses a local relay fixture"
)

async function prepareBrowser(page: Page) {
  await page.addInitScript(() => {
    window.__HTREE_SERVER_URL__ = "http://127.0.0.1:7777"
    localStorage.setItem(
      "reading-translation-v1",
      JSON.stringify({auto: true, target: "en", read: ["fi"]})
    )
    let finish!: () => void
    const ready = new Promise<void>((resolve) => {
      finish = resolve
    })
    Object.assign(window, {
      finishTranslation: finish,
      LanguageDetector: {
        availability: async () => "available",
        create: async () => ({
          detect: async (text: string) => [
            {detectedLanguage: text.startsWith("Suomi") ? "fi" : "sv", confidence: 0.99},
          ],
        }),
      },
      Translator: {
        availability: async () => "available",
        create: async () => ({
          translate: async (text: string) => {
            await ready
            return "English translation of " + text + " with a longer line of text"
          },
          destroy() {},
        }),
      },
    })
  })
}
function finish(page: Page) {
  return page.evaluate(() =>
    (window as unknown as {finishTranslation(): void}).finishTranslation()
  )
}

test("late notes and bios stay still and mixed-language articles switch as one item", async ({
  page,
}, info) => {
  await prepareBrowser(page)
  await page.setViewportSize({width: 390, height: 844})
  const key = generateSecretKey()
  const post = (kind: number, content: string, tags: string[][] = []) =>
    finalizeEvent({kind, content, tags, created_at: Math.floor(Date.now() / 1000)}, key)
  const note = post(1, "Svenska ord här #skog")
  const article = post(
    30023,
    "Svenska ord i **skogen**. [En sida](https://example.org/skog)\n\nSuomi tämä säilyy\n\n```js\nconst original = 1\n```",
    [
      ["d", "skog"],
      ["title", "Svenska rubriken"],
    ]
  )
  const bio = post(0, JSON.stringify({name: "Skog", about: "Svenska ord om mig"}))
  const relay = await Relay.connect("ws://127.0.0.1:7777")
  try {
    for (const event of [note, article, bio]) await relay.publish(event)
  } finally {
    relay.close()
  }

  const main = page.locator("#main-content")
  await page.goto("/" + nip19.noteEncode(note.id))
  const block = main
    .locator("[data-translation-item]")
    .filter({hasText: "Svenska ord här"})
    .first()
  await expect(block).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const before = await block.boundingBox()
  await finish(page)
  await expect(block.getByRole("button", {name: "Translate", exact: true})).toBeVisible()
  expect(await block.boundingBox()).toEqual(before)
  await block.getByRole("button", {name: "Translate", exact: true}).click()
  await expect(block).toContainText("English translation of Svenska ord här")
  await expect(block.getByRole("link", {name: "#skog"})).toBeVisible()
  await block.getByRole("button", {name: "Show original"}).click()
  await expect(block).not.toContainText("English translation")

  await page.goto("/" + nip19.noteEncode(article.id))
  const story = main
    .locator("[data-translation-item]")
    .filter({has: page.getByRole("heading", {name: "Svenska rubriken"})})
    .first()
  await finish(page)
  await story.getByRole("button", {name: "Translate article"}).click()
  const translated = main
    .locator("[data-translation-item]")
    .filter({hasText: "Suomi tämä säilyy"})
    .first()
  await expect(translated.getByRole("heading")).toContainText("English translation")
  await expect(translated.getByRole("button", {name: "Show original"})).toHaveCount(1)
  await expect(translated.locator("code")).toHaveText(/const original = 1/)
  await expect(translated.locator("a[href='https://example.org/skog']")).toContainText(
    "English translation"
  )
  await expect(translated).not.toContainText("translation of Suomi")
  await page.screenshot({path: info.outputPath("translated-article.png")})
  await translated.getByRole("button", {name: "Show original"}).click()
  await expect(
    main.getByRole("heading", {name: "Svenska rubriken"}).first()
  ).toBeVisible()

  await page.goto("/" + nip19.npubEncode(getPublicKey(key)))
  const description = main
    .locator("[data-translation-item]")
    .filter({hasText: "Svenska ord om mig"})
    .first()
  await expect(description).toBeVisible()
  await finish(page)
  await description.getByRole("button", {name: "Translate", exact: true}).click()
  await expect(description).toContainText("English translation")
})

test("translates an incoming private message and keeps outgoing text original", async ({
  page,
}) => {
  test.skip(usingBuiltDist, "seeds two local messages using the development store")
  await prepareBrowser(page)
  await signUp(page)
  await ensureCurrentDeviceRegistered(page)
  const peer = getPublicKey(generateSecretKey())
  await page.evaluate(async (peer) => {
    const own = JSON.parse(localStorage.getItem("user-storage")!).state.publicKey
    const store = (
      window as unknown as {usePrivateMessagesStore: typeof usePrivateMessagesStore}
    ).usePrivateMessagesStore.getState()
    await store.awaitHydration()
    const ms = Date.now()
    for (const [from, to, content, id] of [
      [peer, own, "Svenska inkommande ord", "1".repeat(64)],
      [own, peer, "Svenska utgående ord", "2".repeat(64)],
    ]) {
      await store.upsert(from, to, {
        id,
        pubkey: from,
        kind: 14,
        created_at: Math.floor(ms / 1000),
        tags: [["ms", String(ms)]],
        content,
      })
    }
  }, peer)
  await page.getByRole("link", {name: "Chats"}).click()
  const requests = page.getByRole("button", {name: /Requests/})
  if ((await requests.isVisible()) && (await requests.locator(".badge").count()))
    await requests.click()
  await page.locator('a[href="/chats/chat"]').first().click()
  const incoming = page.locator('[id="' + "1".repeat(64) + '"]:visible').last()
  const outgoing = page.locator('[id="' + "2".repeat(64) + '"]:visible').last()
  await expect(incoming).toContainText("Svenska inkommande ord")
  await finish(page)
  await incoming.getByRole("button", {name: "Translate", exact: true}).click()
  await expect(incoming).toContainText("English translation")
  await expect(outgoing).toContainText("Svenska utgående ord")
  await expect(outgoing.locator("[data-translation-item]")).toHaveCount(0)
})
