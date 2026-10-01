// @vitest-environment jsdom
import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {
  createPrivateContactSync,
  editPrivateContact,
} from "nostr-social-graph/privateContactSync"
import {
  migrateStoredPrivateContacts,
  privateContactStorageKey,
} from "./privateContactMigration"
const owner = "a".repeat(64),
  other = "b".repeat(64),
  contact = "c".repeat(64)
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("navigator", {
    locks: {request: async (_name: string, run: () => unknown) => run()},
  })
})
afterEach(() => vi.unstubAllGlobals())
it("durably upgrades all old registers and clears while preserving unrelated local name history", async () => {
  const old = editPrivateContact(
    createPrivateContactSync(owner, "1".repeat(32)),
    contact,
    {favorite: false, nickname: null, note: "Only my devices"},
    "2".repeat(32)
  )
  localStorage.setItem(privateContactStorageKey(owner), JSON.stringify(old))
  localStorage.setItem("first-interaction", "Original public name")
  const upgraded = await migrateStoredPrivateContacts(owner)
  expect(upgraded.version).toBe(2)
  expect(upgraded.contacts).toEqual(old.contacts)
  expect(Object.keys(upgraded.pending)).toEqual([contact])
  expect(JSON.parse(localStorage.getItem(privateContactStorageKey(owner))!)).toEqual(
    upgraded
  )
  expect(localStorage.getItem("first-interaction")).toBe("Original public name")
  expect(await migrateStoredPrivateContacts(owner)).toEqual(upgraded)
  expect((await migrateStoredPrivateContacts(other)).contacts).toEqual({})
})
it("does not report migration complete if the durable write fails", async () => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {
      throw new Error("disk full")
    },
  })
  await expect(migrateStoredPrivateContacts(owner)).rejects.toThrow("disk full")
})
it("fails closed on corrupt prior state without replacing it", async () => {
  localStorage.setItem(privateContactStorageKey(owner), "{broken")
  await expect(migrateStoredPrivateContacts(owner)).rejects.toThrow()
  expect(localStorage.getItem(privateContactStorageKey(owner))).toBe("{broken")
})
