import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, generateSecretKey, nip19} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

type Hit = {
  item: {pubKey: string; name: string}
  source: "local" | "remote"
  score: number
}

declare global {
  interface Window {
    mentionSearchTest: {
      queries: string[]
      reply: (query: string, results: Hit[], complete: boolean) => void
    }
  }
}

const ben: Hit = {
  item: {pubKey: "11".repeat(32), name: "Ben Arc"},
  source: "local",
  score: 0.01,
}
const bella: Hit = {
  item: {pubKey: "22".repeat(32), name: "Bellatrix"},
  source: "local",
  score: 0.4,
}

// Control only search replies so asynchronous races are deterministic, including
// against the production bundle. The composer, worker transport and UI stay real.
async function controlSearch(page: Page) {
  await page.addInitScript(() => {
    const requests: Array<{worker: Worker; query: string; id: number}> = []
    const original = Worker.prototype.postMessage
    window.mentionSearchTest = {
      queries: [],
      reply(query, results, complete) {
        const request = requests.findLast((entry) => entry.query === query)
        if (!request) throw new Error(`No search for ${query}`)
        request.worker.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "searchResult",
              searchRequestId: request.id,
              searchResults: results,
              searchComplete: complete,
            },
          })
        )
      },
    }
    Worker.prototype.postMessage = function (message, ...args) {
      if (message?.type === "search") {
        requests.push({
          worker: this,
          query: message.searchQuery,
          id: message.searchRequestId,
        })
        window.mentionSearchTest.queries.push(message.searchQuery)
        return
      }
      return original.call(this, message, ...args)
    }
  })
}

async function reply(page: Page, query: string, hits: Hit[], complete = true) {
  await expect
    .poll(() => page.evaluate((q) => window.mentionSearchTest.queries.includes(q), query))
    .toBe(true)
  await page.evaluate(
    ({query, hits, complete}) => {
      window.mentionSearchTest.reply(query, hits, complete)
    },
    {query, hits, complete}
  )
}

async function openComposer(page: Page) {
  const newPost = page.locator('[data-testid="new-post-button"]:visible').first()
  if (await newPost.isVisible()) {
    await newPost.click()
    return page.getByRole("dialog").getByPlaceholder("What's on your mind?")
  }
  await page.locator('footer a[href="/new"]').click()
  return page.locator('textarea[placeholder="What\'s on your mind?"]:visible')
}

test("one-character mentions search immediately and rank like the top search", async ({
  page,
}, testInfo) => {
  await controlSearch(page)
  await signUp(page)
  const search = page.getByPlaceholder("Search", {exact: true}).first()
  await search.fill("ben")
  await reply(page, "ben", [bella, ben])
  const topRows = page.locator(".dropdown-content").getByTestId("sidebar-user-row")
  const topNames = [ben.item.name, bella.item.name]
  await expect(topRows).toHaveText(topNames)
  await search.fill("")

  const composer = await openComposer(page)
  await composer.pressSequentially("@b")
  await reply(page, "b", [bella, ben])
  const picker = page.getByRole("listbox", {name: "Mention suggestions"})
  await expect(picker).toBeVisible()
  await composer.pressSequentially("en")
  await reply(page, "ben", [bella, ben], false)
  await expect(picker.getByTestId("sidebar-user-row")).toHaveText(topNames)
  await page.screenshot({path: testInfo.outputPath("mention-results.png")})
  await composer.dispatchEvent("keydown", {key: "Enter", isComposing: true})
  await expect(composer).toHaveValue("@ben")
  await composer.press("Enter")
  await expect(composer).toHaveValue(`nostr:${nip19.npubEncode(ben.item.pubKey)} `)
  await expect(picker).toHaveCount(0)
  await expect(composer).toBeFocused()
})

test("underscores search spaces, preserve the selected person through updates, and insert at the caret", async ({
  page,
}) => {
  await controlSearch(page)
  await signUp(page)
  const composer = await openComposer(page)
  await composer.fill("\n@Ben_Arc and more")
  for (let i = 0; i < 9; i++) await composer.press("ArrowLeft")
  await reply(
    page,
    "ben arc",
    [ben, {...bella, item: {...bella.item, name: "Ben_Arc_two"}}],
    false
  )
  const picker = page.getByRole("listbox", {name: "Mention suggestions"})
  await expect(picker.getByRole("option")).toHaveCount(2)
  await composer.press("ArrowDown")
  await expect(picker.getByRole("option", {selected: true})).toContainText("Ben_Arc_two")
  await reply(page, "ben arc", [
    {...bella, item: {...bella.item, name: "Ben_Arc_two"}, score: 0},
    {...ben, score: 0.5},
  ])
  await expect(picker.getByRole("option", {selected: true})).toContainText("Ben_Arc_two")
  await composer.press("Tab")
  await expect(composer).toHaveValue(
    `\nnostr:${nip19.npubEncode(bella.item.pubKey)} and more`
  )
  await composer.pressSequentially("here ")
  await expect(composer).toHaveValue(
    `\nnostr:${nip19.npubEncode(bella.item.pubKey)} here and more`
  )
})

test("dismissal and changing the query ignore delayed results without closing the composer", async ({
  page,
}) => {
  await controlSearch(page)
  await signUp(page)
  const composer = await openComposer(page)
  const picker = page.getByRole("listbox", {name: "Mention suggestions"})
  await composer.fill("@ben")
  await reply(page, "ben", [ben], false)
  await expect(picker).toBeVisible()
  await composer.press("Escape")
  await expect(composer).toBeVisible()
  await reply(page, "ben", [ben])
  await expect(picker).toHaveCount(0)

  await composer.fill("@bella")
  await reply(page, "bella", [bella], false)
  await expect(picker).toBeVisible()
  await composer.fill("@unknown")
  await expect(picker).toHaveCount(0)
  await reply(page, "bella", [bella])
  await expect(picker).toHaveCount(0)
  await composer.press("Escape")
  await reply(page, "unknown", [ben])
  await expect(picker).toHaveCount(0)
  await expect(composer).toBeVisible()

  await composer.fill("mail@example.com")
  await expect(picker).toHaveCount(0)

  const unknownNpub = nip19.npubEncode("33".repeat(32))
  await composer.fill(`@${unknownNpub}`)
  await picker.getByRole("option", {name: unknownNpub}).click()
  await expect(composer).toHaveValue(`nostr:${unknownNpub} `)
})

test("pasted npubs resolve a profile and mouse selection publishes the correct mention", async ({
  page,
}) => {
  const secret = generateSecretKey()
  const profile = finalizeEvent(
    {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({name: "Mention_Lookup Person"}),
    },
    secret
  )
  const published: Array<{content: string; tags: string[][]}> = []
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [profile],
    acknowledgeEvent(event, acknowledge) {
      if (event.kind === 1) published.push(event)
      acknowledge()
    },
  })
  try {
    await page.addInitScript((port) => {
      window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
    }, relay.port)
    await signUp(page, nip19.nsecEncode(generateSecretKey()))
    const composer = await openComposer(page)
    const npub = nip19.npubEncode(profile.pubkey)
    await composer.fill(`Hello @${npub}`)
    const option = page.getByRole("option", {name: "Mention_Lookup Person"})
    await expect(option).toBeVisible()
    await option.click()
    await expect(composer).toHaveValue(`Hello nostr:${npub} `)
    await expect(composer).toBeFocused()
    // Exercise the real worker index too: underscores must match both literal
    // underscores and spaces in a discovered profile's name.
    await composer.fill("Hello @Mention_Lookup_Person")
    await expect(option).toBeVisible()
    await option.click()
    await expect(composer).toHaveValue(`Hello nostr:${npub} `)
    await composer
      .locator('xpath=ancestor::*[@data-testid="note-creator"]')
      .getByRole("button", {name: "Post", exact: true})
      .click()
    await expect.poll(() => published.length).toBeGreaterThan(0)
    expect(published[0].content).toBe(`Hello nostr:${npub} `)
    expect(published[0].tags).toContainEqual(["p", profile.pubkey])
  } finally {
    await page.close()
    await relay.close()
  }
})
