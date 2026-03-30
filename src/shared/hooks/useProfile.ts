import {
  NDKEvent,
  NDKUserProfile,
  NDKSubscription,
  NDKSubscriptionCacheUsage,
  profileFromEvent,
} from "@/lib/ndk"
import {handleProfile} from "@/utils/profileSearch"
import {PublicKey} from "@/shared/utils/PublicKey"
import {useCallback, useEffect, useMemo, useSyncExternalStore} from "react"
import {addUsernameToCache} from "@/utils/usernameCache"
import {ndk} from "@/utils/ndk"
import {KIND_METADATA} from "@/utils/constants"
import {getMainThreadDb} from "@/lib/ndk-cache/db"
import {updateNameCache} from "@/utils/profileName"
import {LRUCache} from "typescript-lru-cache"

const PROFILE_CACHE_SIZE = 5000

// Shared LRU cache for profiles - hot cache for active profiles
const profileCache = new LRUCache<string, NDKUserProfile>({
  maxSize: PROFILE_CACHE_SIZE,
})

// Subscribers per pubkey
const subscribers = new Map<string, Set<() => void>>()

function notifySubscribers(pubKeyHex: string) {
  const subs = subscribers.get(pubKeyHex)
  if (subs) {
    subs.forEach((cb) => cb())
  }
}

// Subscription manager - one subscription per pubkey
const activeSubscriptions = new Map<string, {sub: NDKSubscription; refCount: number}>()

function subscribeToProfile(pubKeyHex: string) {
  const existing = activeSubscriptions.get(pubKeyHex)
  if (existing) {
    existing.refCount++
    return () => unsubscribeFromProfile(pubKeyHex)
  }

  const sub = ndk().subscribe(
    {kinds: [KIND_METADATA], authors: [pubKeyHex]},
    {
      closeOnEose: true,
      cacheUsage: NDKSubscriptionCacheUsage.PARALLEL,
    }
  )

  activeSubscriptions.set(pubKeyHex, {sub, refCount: 1})

  let latest = profileCache.get(pubKeyHex)?.created_at || 0
  sub.on("event", (event: NDKEvent) => {
    if (event.pubkey === pubKeyHex && event.kind === KIND_METADATA) {
      if (!event.created_at || event.created_at <= latest) return

      latest = event.created_at
      try {
        const newProfile = profileFromEvent(event)
        if (newProfile.nip05) {
          addUsernameToCache(pubKeyHex, newProfile.nip05, true)
        }
        profileCache.set(pubKeyHex, newProfile)
        updateNameCache(pubKeyHex, newProfile)
        handleProfile(pubKeyHex, newProfile)
        notifySubscribers(pubKeyHex)
      } catch {
        // Invalid profile event
      }
    }
  })

  return () => unsubscribeFromProfile(pubKeyHex)
}

function unsubscribeFromProfile(pubKeyHex: string) {
  const existing = activeSubscriptions.get(pubKeyHex)
  if (!existing) return

  existing.refCount--
  if (existing.refCount <= 0) {
    existing.sub.stop()
    activeSubscriptions.delete(pubKeyHex)
  }
}

export default function useProfile(pubKey?: string, subscribe = true) {
  const pubKeyHex = useMemo(() => {
    if (!pubKey) return ""
    try {
      return new PublicKey(pubKey).toString()
    } catch (e) {
      console.warn(`Invalid pubkey: ${pubKey}`)
      return ""
    }
  }, [pubKey])

  // Load from Dexie on mount if not in cache (stale-while-revalidate)
  useEffect(() => {
    if (!pubKeyHex) return

    const cached = profileCache.get(pubKeyHex)
    if (cached) return

    // Fetch from Dexie in background
    const db = getMainThreadDb()
    db.profiles.get(pubKeyHex).then((dexieProfile) => {
      if (dexieProfile) {
        profileCache.set(pubKeyHex, dexieProfile)
        updateNameCache(pubKeyHex, dexieProfile)
        notifySubscribers(pubKeyHex)
      }
    })
  }, [pubKeyHex])

  // Subscribe to NDK updates
  useEffect(() => {
    if (!pubKeyHex || !subscribe) return
    return subscribeToProfile(pubKeyHex)
  }, [pubKeyHex, subscribe])

  // Stable subscribe function for useSyncExternalStore
  const subscribeToStore = useCallback(
    (callback: () => void) => {
      if (!pubKeyHex) return () => {}

      let subs = subscribers.get(pubKeyHex)
      if (!subs) {
        subs = new Set()
        subscribers.set(pubKeyHex, subs)
      }
      subs.add(callback)

      return () => {
        subs?.delete(callback)
        if (subs?.size === 0) {
          subscribers.delete(pubKeyHex)
        }
      }
    },
    [pubKeyHex]
  )

  const getSnapshot = useCallback(() => {
    return pubKeyHex ? profileCache.get(pubKeyHex) || null : null
  }, [pubKeyHex])

  // Use external store pattern
  const profile = useSyncExternalStore(subscribeToStore, getSnapshot, getSnapshot)

  return profile
}
