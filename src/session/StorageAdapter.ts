import localForage from "localforage"
import {StorageAdapter, LocalStorageAdapter} from "nostr-double-ratchet/src"

/**
 * LocalForage-based storage adapter with IndexedDB backend.
 * Includes auto-migration from localStorage for backwards compatibility.
 */
export class LocalForageStorageAdapter implements StorageAdapter {
  private readonly keyPrefix = "private"
  private readonly store: typeof localForage
  private pendingMigration: Promise<void> | null

  constructor() {
    this.store = localForage.createInstance({
      name: "iris-session-manager",
      storeName: "session-private",
    })

    this.pendingMigration = this.shouldAttemptMigration()
      ? this.migrateFromLocalStorage()
      : null
  }

  private shouldAttemptMigration() {
    return typeof window !== "undefined" && Boolean(window.localStorage)
  }

  private async ensureReady() {
    if (this.pendingMigration) {
      await this.pendingMigration
      this.pendingMigration = null
    }
  }

  private getFullKey(key: string): string {
    return `${this.keyPrefix}${key}`
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    await this.ensureReady()
    try {
      const item = await this.store.getItem<T>(this.getFullKey(key))
      return item ?? undefined
    } catch (e) {
      console.warn(`Failed to get key ${key} from localForage:`, e)
      return undefined
    }
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    await this.ensureReady()
    try {
      await this.store.setItem(this.getFullKey(key), value)
    } catch (e) {
      console.error(`Failed to put key ${key} to localForage:`, e)
      throw e
    }
  }

  async del(key: string): Promise<void> {
    await this.ensureReady()
    try {
      await this.store.removeItem(this.getFullKey(key))
    } catch (e) {
      console.warn(`Failed to delete key ${key} from localForage:`, e)
    }
  }

  async list(prefix = ""): Promise<string[]> {
    await this.ensureReady()
    const keys: string[] = []
    const searchPrefix = this.getFullKey(prefix)
    try {
      const storeKeys = await this.store.keys()
      for (const key of storeKeys) {
        if (key.startsWith(searchPrefix)) {
          keys.push(key.substring(this.keyPrefix.length))
        }
      }
    } catch (e) {
      console.warn("Failed to list keys from localForage:", e)
    }
    return keys
  }

  private async migrateFromLocalStorage() {
    if (typeof window === "undefined" || !window.localStorage) return

    const legacy = new LocalStorageAdapter(this.keyPrefix)
    try {
      const keys = await legacy.list("")
      if (!keys.length) return

      await Promise.all(
        keys.map(async (key) => {
          const value = await legacy.get(key)
          if (value === undefined) return
          await this.store.setItem(this.getFullKey(key), value)
          await legacy.del(key)
        })
      )
    } catch (e) {
      console.error("Failed migrating session data from localStorage to localForage:", e)
    }
  }
}
