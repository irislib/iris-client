import localForage from "localforage"

/*
 * Simple async key	value storage interface plus an in	memory implementation.
 *
 * All methods are Promise	based to accommodate back	ends like
 * IndexedDB, SQLite, remote HTTP APIs, etc.  For environments where you only
 * need ephemeral data (tests, Node scripts) the InMemoryStorageAdapter can be
 * used directly.
 */

export interface StorageAdapter {
  /** Retrieve a value by key. */
  get<T = unknown>(key: string): Promise<T | undefined>
  /** Store a value by key. */
  put<T = unknown>(key: string, value: T): Promise<void>
  /** Delete a stored value by key. */
  del(key: string): Promise<void>
  /** List all keys that start with the given prefix. */
  list(prefix?: string): Promise<string[]>
}

export class InMemoryStorageAdapter implements StorageAdapter {
  private store = new Map<string, unknown>()

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    this.store.set(key, value)
  }

  async del(key: string): Promise<void> {
    this.store.delete(key)
  }

  async list(prefix = ""): Promise<string[]> {
    const keys: string[] = []
    const storeKeys = Array.from(this.store.keys())
    for (const k of storeKeys) {
      if (k.startsWith(prefix)) keys.push(k)
    }
    return keys
  }
}

export class LocalStorageAdapter implements StorageAdapter {
  private keyPrefix: string

  constructor(keyPrefix = "session_") {
    this.keyPrefix = keyPrefix
  }

  private getFullKey(key: string): string {
    return `${this.keyPrefix}${key}`
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    try {
      const item = localStorage.getItem(this.getFullKey(key))
      return item ? JSON.parse(item) : undefined
    } catch (e) {
      console.warn(`Failed to get key ${key} from localStorage:`, e)
      return undefined
    }
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    try {
      localStorage.setItem(this.getFullKey(key), JSON.stringify(value))
    } catch (e) {
      console.error(`Failed to put key ${key} to localStorage:`, e)
      throw e
    }
  }

  async del(key: string): Promise<void> {
    try {
      localStorage.removeItem(this.getFullKey(key))
    } catch (e) {
      console.warn(`Failed to delete key ${key} from localStorage:`, e)
    }
  }

  async list(prefix = ""): Promise<string[]> {
    const keys: string[] = []
    const searchPrefix = this.getFullKey(prefix)

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith(searchPrefix)) {
          // Remove our prefix to return the original key
          keys.push(key.substring(this.keyPrefix.length))
        }
      }
    } catch (e) {
      console.warn("Failed to list keys from localStorage:", e)
    }

    return keys
  }
}

export class LocalForageStorageAdapter implements StorageAdapter {
  private readonly keyPrefix = "private"
  private readonly store: typeof localForage
  private pendingMigration: Promise<void> | null

  constructor() {
    this.store = localForage.createInstance({
      name: "iris-session-manager",
      storeName: "session-private",
    })

    this.pendingMigration = this.shouldAttemptMigration() ? this.migrateFromLocalStorage() : null
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
