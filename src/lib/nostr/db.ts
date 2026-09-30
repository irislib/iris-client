import type {RuntimeOutboxEntry} from "nostr-pubsub"
import type {UserProfile} from "@/lib/nostr"
import Dexie, {type Table} from "dexie"

export interface Profile extends UserProfile {
  pubkey: string
  cachedAt: number
}

export interface Event {
  id: string
  pubkey: string
  kind: number
  createdAt: number
  relay?: string
  event: string
  sig?: string
  priority?: number
  tagIndex?: string[]
}

export type UnpublishedEvent = RuntimeOutboxEntry & {id: string}

export interface CacheData {
  key: string
  data: unknown
  cachedAt: number
}

export class Database extends Dexie {
  profiles!: Table<Profile>
  events!: Table<Event>
  unpublishedEvents!: Table<UnpublishedEvent>
  cacheData!: Table<CacheData>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      profiles: "&pubkey",
      events:
        "&id, kind, pubkey, createdAt, [kind+createdAt], [pubkey+createdAt], *tagIndex",
      unpublishedEvents: "&id",
      cacheData: "&key, cachedAt",
    })
  }
}

export let db: Database

/**
 * Create database
 *
 * @param name - Database name
 */
export function createDatabase(_name?: string): void {
  if (!db) db = new Database("iris-pubsub")
}

/**
 * Get or create database connection for main thread
 * Uses the same database name as the worker
 */
export function getMainThreadDb(): Database {
  if (!db) {
    db = new Database("iris-pubsub")
  }
  return db
}
