import {LRUCache} from "typescript-lru-cache"
import {type Profile} from "@/lib/ndk-cache/db"
import {NDKUserProfile} from "@/lib/ndk"
import AnimalName from "./AnimalName"

type ProfileLike = Profile | NDKUserProfile | null | undefined

// Small in-memory cache for sync access, auto-expires after 5 minutes
const nameCache = new LRUCache<string, string>({
  maxSize: 10000,
  entryExpirationTimeInMS: 5 * 60 * 1000,
})

/**
 * Get a display name for a pubkey synchronously.
 * Returns cached name if available, otherwise AnimalName.
 * The cache is populated when profiles are fetched or updated.
 */
export function getCachedName(pubKey: string): string {
  if (!pubKey) return ""
  const cached = nameCache.get(pubKey)
  if (cached) return cached
  return AnimalName(pubKey)
}

/**
 * Extract display name from profile object
 */
export function getNameFromProfile(profile: ProfileLike, pubKey: string): string {
  if (!profile) return AnimalName(pubKey)

  const name =
    profile.name ||
    profile.displayName ||
    (typeof profile.display_name === "string" ? profile.display_name : undefined)

  return name || AnimalName(pubKey)
}

/**
 * Update the name cache when a profile is fetched
 */
export function updateNameCache(pubKey: string, profile: ProfileLike) {
  if (!pubKey) return
  const name = getNameFromProfile(profile, pubKey)
  nameCache.set(pubKey, name)
}
