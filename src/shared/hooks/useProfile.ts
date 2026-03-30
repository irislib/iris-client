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

// In-memory store for profiles that are actively being rendered on screen.
const profileStore = new Map<string, NDKUserProfile>()
const pendingProfileLoads = new Map<string, Promise<void>>()

// Subscribers per pubkey
const subscribers = new Map<string, Set<() => void>>()

function notifySubscribers(pubKeyHex: string) {
  const subs = subscribers.get(pubKeyHex)
  if (subs) {
    subs.forEach((cb) => cb())
  }
}

function sanitizeProfileForUi(profile?: NDKUserProfile | null): NDKUserProfile | null {
  if (!profile) return null

  const displayName =
    profile.displayName ||
    (typeof profile.display_name === "string" ? profile.display_name : undefined)
  const picture = profile.picture || profile.image

  return {
    created_at: profile.created_at,
    name: profile.name,
    username: profile.username,
    displayName,
    display_name: displayName,
    picture,
    image: picture,
    banner: profile.banner,
    bio: profile.bio,
    nip05: profile.nip05,
    lud06: profile.lud06,
    lud16: profile.lud16,
    about: profile.about,
    website: profile.website,
  }
}

function cleanupProfile(pubKeyHex: string) {
  if (subscribers.has(pubKeyHex)) return
  if (activeSubscriptions.has(pubKeyHex)) return
  profileStore.delete(pubKeyHex)
}

function loadProfileFromDb(pubKeyHex: string) {
  const existingLoad = pendingProfileLoads.get(pubKeyHex)
  if (existingLoad) {
    return existingLoad
  }

  const db = getMainThreadDb()
  const load = db.profiles
    .get(pubKeyHex)
    .then((dexieProfile) => {
      const profile = sanitizeProfileForUi(dexieProfile)
      if (!profile) return
      profileStore.set(pubKeyHex, profile)
      updateNameCache(pubKeyHex, profile)
      notifySubscribers(pubKeyHex)
    })
    .finally(() => {
      pendingProfileLoads.delete(pubKeyHex)
      cleanupProfile(pubKeyHex)
    })

  pendingProfileLoads.set(pubKeyHex, load)
  return load
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

  let latest = profileStore.get(pubKeyHex)?.created_at || 0
  sub.on("event", (event: NDKEvent) => {
    if (event.pubkey === pubKeyHex && event.kind === KIND_METADATA) {
      if (!event.created_at || event.created_at <= latest) return

      latest = event.created_at
      try {
        const newProfile = sanitizeProfileForUi(profileFromEvent(event))
        if (!newProfile) return
        if (newProfile.nip05) {
          addUsernameToCache(pubKeyHex, newProfile.nip05, true)
        }
        profileStore.set(pubKeyHex, newProfile)
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
  cleanupProfile(pubKeyHex)
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

    if (profileStore.has(pubKeyHex)) return
    void loadProfileFromDb(pubKeyHex)
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
        cleanupProfile(pubKeyHex)
      }
    },
    [pubKeyHex]
  )

  const getSnapshot = useCallback(() => {
    return pubKeyHex ? profileStore.get(pubKeyHex) || null : null
  }, [pubKeyHex])

  // Use external store pattern
  const profile = useSyncExternalStore(subscribeToStore, getSnapshot, getSnapshot)

  return profile
}
