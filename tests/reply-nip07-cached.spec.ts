import {test, expect, type Page} from "@playwright/test"
import {nip19, finalizeEvent, getPublicKey, type EventTemplate} from "nostr-tools"

const signerKey = new Uint8Array(32).fill(17)
test.beforeEach(async ({page}) => {
  await page.exposeFunction("signTestEvent", (event: EventTemplate) =>
    finalizeEvent(event, signerKey)
  )
})

const seedCachedEvent = async (
  page: Page,
  event: {
    id: string
    pubkey: string
    kind: number
    createdAt: number
    serialized: string
    sig: string
  }
) => {
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await indexedDB.databases()).some((database) => database.name === "iris-pubsub")
      )
    )
    .toBe(true)
  await page.evaluate(async (cachedEvent) => {
    const serialized = JSON.parse(cachedEvent.serialized)
    const event = {
      id: cachedEvent.id,
      pubkey: cachedEvent.pubkey,
      kind: cachedEvent.kind,
      created_at: cachedEvent.createdAt,
      tags: serialized[4],
      content: serialized[5],
      sig: cachedEvent.sig,
    }
    const record = {
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      createdAt: event.created_at,
      event: JSON.stringify(event),
      sig: event.sig,
      tagIndex: event.tags.map((tag: string[]) => `${tag[0]}:${tag[1]}`),
    }
    // Seed the actual persisted cache in both dev and production builds.
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("iris-pubsub")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("events", "readwrite")
        transaction.objectStore("events").put(record)
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error)
        transaction.onerror = () => reject(transaction.error)
      })
    } finally {
      database.close()
    }
  }, event)
}

test("NIP-07 login can reply to a cached post detail event", async ({page}) => {
  const consoleMessages: string[] = []
  const myPubkey = getPublicKey(signerKey)
  const rootAuthor = "2".repeat(64)
  const parentAuthor = "3".repeat(64)
  const rootId = "4".repeat(64)
  const parentId = "5".repeat(64)
  const parentContent = "Cached parent from IDB"

  await page.addInitScript((pubkey) => {
    localStorage.setItem(
      "user-storage",
      JSON.stringify({
        state: {
          publicKey: pubkey,
          privateKey: "",
          nip07Login: true,
          linkedDevice: false,
          relayConfigs: [],
          relays: [],
        },
        version: 3,
      })
    )

    window.nostr = {
      getPublicKey: async () => pubkey,
      signEvent: async (event) => (window as any).signTestEvent(event),
      getRelays: async () => ({}),
    }
  }, myPubkey)

  page.on("console", (message) => {
    consoleMessages.push(`${message.type()}: ${message.text()}`)
  })

  await page.goto("/")
  await expect(page.locator("#main-content").getByTestId("new-post-button")).toBeVisible()

  await seedCachedEvent(page, {
    id: parentId,
    pubkey: parentAuthor,
    kind: 1,
    createdAt: 1700000000,
    sig: "6".repeat(128),
    serialized: JSON.stringify([
      0,
      parentAuthor,
      1700000000,
      1,
      [
        ["e", rootId, "", "root", rootAuthor],
        ["p", rootAuthor],
      ],
      parentContent,
      "6".repeat(128),
      parentId,
    ]),
  })

  await page.goto(`/${nip19.noteEncode(parentId)}`)
  await expect(page.getByText(parentContent)).toBeVisible()

  await page.getByPlaceholder("Write your reply...").fill("NIP07 cached reply smoke")
  await page.getByTestId("note-creator").getByRole("button", {name: "Reply"}).click()

  await expect(page.getByPlaceholder("Write your reply...")).toHaveValue("")
  expect(
    consoleMessages.filter((line) =>
      /No NDK instance found|Failed to create note/i.test(line)
    )
  ).toEqual([])
})

test("important NIP-07 reply failures keep the draft and show a toast", async ({
  page,
}) => {
  const myPubkey = getPublicKey(signerKey)
  const parentAuthor = "3".repeat(64)
  const parentId = "8".repeat(64)
  const parentContent = "Cached parent with rejected NIP-07 reply signing"
  const replyDraft = "Reply draft should survive signing rejection"

  await page.addInitScript((pubkey) => {
    localStorage.setItem(
      "user-storage",
      JSON.stringify({
        state: {
          publicKey: pubkey,
          privateKey: "",
          nip07Login: true,
          linkedDevice: false,
          relayConfigs: [],
          relays: [],
        },
        version: 3,
      })
    )

    window.nostr = {
      getPublicKey: async () => pubkey,
      signEvent: async () => {
        throw new Error("User rejected signing")
      },
      getRelays: async () => ({}),
    }
  }, myPubkey)

  await page.goto("/")
  await seedCachedEvent(page, {
    id: parentId,
    pubkey: parentAuthor,
    kind: 1,
    createdAt: 1_700_000_000,
    sig: "6".repeat(128),
    serialized: JSON.stringify([
      0,
      parentAuthor,
      1_700_000_000,
      1,
      [],
      parentContent,
      "6".repeat(128),
      parentId,
    ]),
  })

  await page.goto(`/${nip19.noteEncode(parentId)}`)
  await expect(page.getByText(parentContent)).toBeVisible()

  const replyInput = page.getByPlaceholder("Write your reply...")
  await replyInput.fill(replyDraft)
  await page.getByTestId("note-creator").getByRole("button", {name: "Reply"}).click()

  await expect(
    page.getByText("Could not publish reply: User rejected signing", {exact: true})
  ).toBeVisible()
  await expect(replyInput).toHaveValue(replyDraft)
})

test("NIP-07 login can like a cached post without an attached client", async ({page}) => {
  const myPubkey = getPublicKey(signerKey)
  const noteAuthor = "2".repeat(64)
  const noteId = "4".repeat(64)
  const noteContent = "Cached note to like through NIP-07"

  await page.addInitScript((pubkey) => {
    localStorage.setItem(
      "user-storage",
      JSON.stringify({
        state: {
          publicKey: pubkey,
          privateKey: "",
          nip07Login: true,
          linkedDevice: false,
          relayConfigs: [],
          relays: [],
        },
        version: 3,
      })
    )

    ;(window as Window & {signedKinds?: number[]}).signedKinds = []
    window.nostr = {
      getPublicKey: async () => pubkey,
      signEvent: async (event) => {
        ;(window as Window & {signedKinds?: number[]}).signedKinds?.push(event.kind)
        return (window as any).signTestEvent(event)
      },
      getRelays: async () => ({}),
    }
  }, myPubkey)

  await page.goto("/")
  await seedCachedEvent(page, {
    id: noteId,
    pubkey: noteAuthor,
    kind: 1,
    createdAt: 1_700_000_000,
    sig: "6".repeat(128),
    serialized: JSON.stringify([
      0,
      noteAuthor,
      1_700_000_000,
      1,
      [],
      noteContent,
      "6".repeat(128),
      noteId,
    ]),
  })

  await page.goto(`/${nip19.noteEncode(noteId)}`)
  const feedItem = page
    .locator('[data-testid="feed-item"]:visible')
    .filter({hasText: noteContent})
    .first()
  await expect(feedItem).toBeVisible()

  const likeButton = feedItem.getByTestId("like-button")
  await likeButton.click()

  await expect
    .poll(() =>
      likeButton.evaluate((element) => element.classList.contains("text-error"))
    )
    .toBe(true)
  await expect(feedItem.getByTestId("like-count")).toHaveText("1")
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & {signedKinds?: number[]}).signedKinds ?? [])
    )
    .toContain(7)
  await expect(page.getByText(/Could not publish reaction:/)).toHaveCount(0)
})

test("important NIP-07 reaction failures roll back and show a toast", async ({page}) => {
  const myPubkey = getPublicKey(signerKey)
  const noteAuthor = "2".repeat(64)
  const noteId = "5".repeat(64)
  const noteContent = "Cached note with rejected NIP-07 signing"

  await page.addInitScript((pubkey) => {
    localStorage.setItem(
      "user-storage",
      JSON.stringify({
        state: {
          publicKey: pubkey,
          privateKey: "",
          nip07Login: true,
          linkedDevice: false,
          relayConfigs: [],
          relays: [],
        },
        version: 3,
      })
    )

    window.nostr = {
      getPublicKey: async () => pubkey,
      signEvent: async () => {
        throw new Error("User rejected signing")
      },
      getRelays: async () => ({}),
    }
  }, myPubkey)

  await page.goto("/")
  await seedCachedEvent(page, {
    id: noteId,
    pubkey: noteAuthor,
    kind: 1,
    createdAt: 1_700_000_000,
    sig: "6".repeat(128),
    serialized: JSON.stringify([
      0,
      noteAuthor,
      1_700_000_000,
      1,
      [],
      noteContent,
      "6".repeat(128),
      noteId,
    ]),
  })

  await page.goto(`/${nip19.noteEncode(noteId)}`)
  const feedItem = page
    .locator('[data-testid="feed-item"]:visible')
    .filter({hasText: noteContent})
    .first()
  await expect(feedItem).toBeVisible()

  const likeButton = feedItem.getByTestId("like-button")
  await likeButton.click()

  await expect(
    page.getByText("Could not publish reaction: User rejected signing", {exact: true})
  ).toBeVisible()
  await expect
    .poll(() =>
      likeButton.evaluate((element) => element.classList.contains("text-error"))
    )
    .toBe(false)
  await expect(feedItem.getByTestId("like-count")).toHaveText("0")
})
