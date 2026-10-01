import {
  createPrivateContactSync,
  migratePrivateContactSync,
} from "nostr-social-graph/privateContactSyncV2"

export const privateContactStorageKey = (owner: string) =>
  `nostr-social-memory:v1:${owner}`
/** Preserve every field before retiring obsolete plaintext transport queues. */
export async function migrateStoredPrivateContacts(owner: string) {
  if (!/^[0-9a-f]{64}$/.test(owner) || !navigator.locks)
    throw new Error("Private device sync is unavailable")
  const key = privateContactStorageKey(owner)
  return navigator.locks.request(key, () => {
    const saved = localStorage.getItem(key)
    const state = saved
      ? migratePrivateContactSync(JSON.parse(saved), owner)
      : createPrivateContactSync(owner, crypto.randomUUID().replaceAll("-", ""))
    localStorage.setItem(key, JSON.stringify(state))
    return state
  })
}
