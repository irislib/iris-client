import {test, expect, type Page} from "@playwright/test"
import {nip19} from "nostr-tools"

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
  await page.evaluate(async (cachedEvent) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("treelike-nostr")

      request.onupgradeneeded = () => {
        const db = request.result
        const createObjectStore = (
          name: string,
          options: IDBObjectStoreParameters,
          indexes: Array<[string, string | string[]]> = []
        ) => {
          if (db.objectStoreNames.contains(name)) return
          const store = db.createObjectStore(name, options)
          indexes.forEach(([indexName, keyPath]) => store.createIndex(indexName, keyPath))
        }

        createObjectStore("profiles", {keyPath: "pubkey"})
        createObjectStore("events", {keyPath: "id"}, [
          ["kind", "kind"],
          ["priority", "priority"],
        ])
        createObjectStore("eventTags", {keyPath: "tagValue"})
        createObjectStore("nip05", {keyPath: "nip05"})
        createObjectStore("lnurl", {keyPath: "pubkey"})
        createObjectStore("relayStatus", {keyPath: "url"})
        createObjectStore("unpublishedEvents", {keyPath: "id"})
        createObjectStore("eventRelays", {keyPath: ["eventId", "relayUrl"]}, [
          ["eventId", "eventId"],
        ])
        createObjectStore("decryptedEvents", {keyPath: "id"})
        createObjectStore("cacheData", {keyPath: "key"}, [["cachedAt", "cachedAt"]])
      }

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction("events", "readwrite")
        tx.objectStore("events").put({
          id: cachedEvent.id,
          pubkey: cachedEvent.pubkey,
          kind: cachedEvent.kind,
          createdAt: cachedEvent.createdAt,
          event: cachedEvent.serialized,
          sig: cachedEvent.sig,
          priority: 1,
        })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  }, event)
}

test("NIP-07 login can reply to a cached post detail event", async ({page}) => {
  const consoleMessages: string[] = []
  const myPubkey = "1".repeat(64)
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
      signEvent: async (event) => ({...event, sig: "7".repeat(128)}),
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
  await page.getByRole("button", {name: "Reply"}).click()

  await expect(page.getByPlaceholder("Write your reply...")).toHaveValue("")
  expect(
    consoleMessages.filter((line) =>
      /No NDK instance found|Failed to create note/i.test(line)
    )
  ).toEqual([])
})
