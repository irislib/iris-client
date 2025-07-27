// import {getProfileContent} from "applesauce-core/helpers" // unused
import {LRUCache} from "typescript-lru-cache"
import throttle from "lodash/throttle"
import localforage from "localforage"

// Constants for profile data sanitization
const PROFILE_NAME_MAX_LENGTH = 50
const PROFILE_PICTURE_URL_MAX_LENGTH = 500

export const profileCache = new LRUCache<string, any>({maxSize: 100000})

// Helper functions for profile data sanitization
const shouldRejectNip05 = (nip05: string, name: string): boolean => {
  return (
    nip05.length === 1 ||
    nip05.startsWith("npub1") ||
    name.toLowerCase().replace(/\s+/g, "").includes(nip05)
  )
}

const sanitizeName = (name: string): string => {
  return name.trim().slice(0, PROFILE_NAME_MAX_LENGTH)
}

const sanitizeNip05 = (nip05: string, name: string): string | undefined => {
  if (!nip05) return undefined
  const sanitized = nip05
    .split("@")[0]
    .trim()
    .toLowerCase()
    .slice(0, PROFILE_NAME_MAX_LENGTH)
  return shouldRejectNip05(sanitized, name) ? undefined : sanitized
}

const sanitizePicture = (picture: string): string | undefined => {
  if (!picture || picture.length > PROFILE_PICTURE_URL_MAX_LENGTH) return undefined
  return picture.trim().replace(/^https:\/\//, "")
}

// Convert condensed array to any
const arrayToProfile = (item: string[]): any => {
  const [, name, nip05, picture] = item
  const profile: any = {}

  if (name) {
    profile.name = name
    profile.username = name
  }
  if (nip05) {
    profile.nip05 = nip05
  }
  if (picture) {
    profile.picture = picture.startsWith("http") ? picture : `https://${picture}`
  }

  return profile
}

// Convert any to condensed array format
const profileToArray = (pubkey: string, profile: any): string[] => {
  const name = sanitizeName((profile.name || profile.username || "").toString())
  if (!name) return [] // Skip profiles without names

  const nip05 = sanitizeNip05(profile.nip05 || "", name)
  const picture = sanitizePicture(profile.picture || "")

  const item = [pubkey, name]
  if (nip05) {
    item.push(nip05)
  } else if (picture) {
    item.push("") // Placeholder for nip05 if picture exists
  }
  if (picture) {
    item.push(picture)
  }

  return item
}

const throttledSaveProfiles = throttle(() => {
  const profileData: string[][] = []
  profileCache.forEach((profile, pubkey) => {
    const arrayData = profileToArray(String(pubkey), profile)
    if (arrayData.length > 0) {
      profileData.push(arrayData)
    }
  })
  localforage.setItem("profileCache", profileData)
}, 5000)

// Load profileCache from localForage
export const loadProfileCache = (): Promise<void> => {
  return localforage
    .getItem("profileCache")
    .then(async (savedData: unknown) => {
      let validData = false

      // Try to load new condensed format
      if (Array.isArray(savedData) && savedData.length > 0) {
        const firstItem = savedData[0]
        if (
          Array.isArray(firstItem) &&
          typeof firstItem[0] === "string" &&
          typeof firstItem[1] === "string"
        ) {
          // New format: string[][]
          let loadedCount = 0
          savedData.forEach((item: string[]) => {
            if (item.length >= 2 && item[0] && item[1]) {
              profileCache.set(item[0], arrayToProfile(item))
              loadedCount++
            }
          })
          console.log(`Loaded ${loadedCount} profiles from localforage cache`)
          validData = true
        } else if (
          Array.isArray(firstItem) &&
          firstItem.length === 2 &&
          typeof firstItem[1] === "object"
        ) {
          // Old format: [string, any][] - delete it
          console.log("Found old format profile cache, deleting...")
          await localforage.removeItem("profileCache")
        }
      }

      if (!validData) {
        // No valid cached profiles, load from profileData.json
        console.log("No cached profiles found, loading from profileData.json")
        const {default: profileJson} = await import(
          "nostr-social-graph/data/profileData.json"
        )
        profileJson.forEach((v) => {
          if (v[0] && v[1]) {
            let pictureUrl = v[3]
            if (pictureUrl && !pictureUrl.startsWith("http://")) {
              pictureUrl = `https://${pictureUrl}`
            }
            addCachedProfile(v[0], {username: v[1], picture: pictureUrl || undefined})
          }
        })
      }
    })
    .catch((e) => {
      console.error("failed to load profileCache:", e)
      throw e
    })
}

export const addCachedProfile = (pubkey: string, profile: any) => {
  // Only cache profiles with names
  const name = sanitizeName(
    (profile.name || profile.display_name || profile.username || "").toString()
  )
  if (name) {
    profileCache.set(pubkey, profile)
    throttledSaveProfiles()
  }
}

// Initialize profile cache on module load
loadProfileCache().catch(() => {
  // Error already logged in loadProfileCache
})
