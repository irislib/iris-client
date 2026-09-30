import {AppEvent} from "@/lib/nostr"
import {LRUCache} from "typescript-lru-cache"
import {getMainThreadDb} from "@/lib/nostr/db"
import {deserialize} from "@/lib/nostr"

// Hot cache for recently accessed events - immutable, no revalidation needed
const eventCache = new LRUCache<string, AppEvent>({
  maxSize: 200,
})

/**
 * Get event by ID from cache or IDB.
 * Returns immediately if cached, otherwise fetches from IDB.
 */
export async function getEvent(eventId: string): Promise<AppEvent | null> {
  // Check hot cache first
  const cached = eventCache.get(eventId)
  if (cached) return cached

  // Fetch from IDB
  try {
    const db = getMainThreadDb()
    const stored = await db.events.get(eventId)
    if (stored) {
      const nostrEvent = deserialize(stored.event)
      const ndkEvent = new AppEvent(undefined, nostrEvent)
      eventCache.set(eventId, ndkEvent)
      return ndkEvent
    }
  } catch (e) {
    console.error("Failed to fetch event from IDB:", e)
  }

  return null
}

/**
 * Get event synchronously from cache only.
 * Returns null if not cached.
 */
export function getEventSync(eventId: string): AppEvent | null {
  return eventCache.get(eventId) || null
}

/**
 * Add event to cache (called when event received from relay).
 */
export function cacheEvent(event: AppEvent): void {
  if (event.id) {
    eventCache.set(event.id, event)
  }
}
