// import {getProfileContent} from "applesauce-core/helpers" // unused
import {profileCache, addCachedProfile, ProfileData} from "@/utils/profileCache"
import {handleProfile} from "@/utils/profileSearch"
import {subscribe} from "@/utils/applesauce"
import debounce from "lodash/debounce"
import Fuse from "fuse.js"

export interface DoubleRatchetUser {
  pubkey: string
  profile: ProfileData
}

// Fuse.js search index
let fuse: Fuse<DoubleRatchetUser> | null = null

const doubleRatchetUsers: Set<string> = new Set()
const userData: Map<string, DoubleRatchetUser> = new Map()

// Subscription system for reactive updates
const subscribers: Set<() => void> = new Set()

const notifySubscribers = () => {
  subscribers.forEach((callback) => callback())
}

// Subscribe to doubleRatchetUsers changes
export const subscribeToDoubleRatchetUsersChanges = (callback: () => void) => {
  subscribers.add(callback)
  return () => {
    subscribers.delete(callback)
  }
}

// Recreate the Fuse.js search index
const recreateSearchIndex = () => {
  fuse = new Fuse(Array.from(userData.values()), {
    keys: ["profile.name", "profile.display_name", "profile.username", "profile.nip05"],
    threshold: 0.3,
    includeScore: true,
  })
}

// Update the search index with new user data (internal)
const updateDoubleRatchetSearchIndexImmediate = () => {
  // Update all users' profiles in the map
  const updatedUsers = new Map<string, DoubleRatchetUser>()

  // Get all users that have profiles
  doubleRatchetUsers.forEach((userPubkey) => {
    const profile = profileCache.get(userPubkey)
    if (profile) {
      updatedUsers.set(userPubkey, {
        pubkey: userPubkey,
        profile,
      })
    }
  })

  // Replace the old map with the updated one
  userData.clear()
  updatedUsers.forEach((user) => userData.set(user.pubkey, user))

  recreateSearchIndex()
  console.log("Updated double ratchet search index", userData.size)

  // If we have users without profiles, fetch them all at once
  const usersWithoutProfiles = Array.from(doubleRatchetUsers).filter(
    (pubkey) => !profileCache.get(pubkey)
  )

  if (usersWithoutProfiles.length > 0) {
    console.log("Fetching profiles for", usersWithoutProfiles.length, "users")
    const sub = subscribe(
      {kinds: [0], authors: usersWithoutProfiles},
      {closeOnEose: true}
    )

    sub.on("event", (event) => {
      if (event.kind === 0) {
        try {
          const profile = JSON.parse(event.content)
          profile.created_at = event.created_at
          addCachedProfile(event.pubkey, profile)
          handleProfile(event.pubkey, profile)
        } catch (e) {
          console.warn("Failed to parse profile for", event.pubkey, e)
        }
      }
    })

    // Update search index again when profiles are loaded
    sub.on("eose", () => {
      updateDoubleRatchetSearchIndexImmediate()
    })
  }

  // Notify subscribers
  notifySubscribers()
}

// Debounced version to prevent excessive rebuilds
const updateDoubleRatchetSearchIndex = debounce(
  updateDoubleRatchetSearchIndexImmediate,
  300
)

// Add a user to the doubleRatchetUsers set
export const addDoubleRatchetUser = (pubkey: string) => {
  doubleRatchetUsers.add(pubkey)
  updateDoubleRatchetSearchIndex()
}

// Remove a user from the doubleRatchetUsers set
export const removeDoubleRatchetUser = (pubkey: string) => {
  doubleRatchetUsers.delete(pubkey)
  userData.delete(pubkey)
  updateDoubleRatchetSearchIndex()
}

// Search for double ratchet users using the Fuse.js index
export const searchDoubleRatchetUsers = (query: string): DoubleRatchetUser[] => {
  if (!fuse || !query.trim()) {
    return []
  }

  const results = fuse.search(query)
  return results.map((result) => result.item)
}

// Get all double ratchet users
export const getAllDoubleRatchetUsers = (): DoubleRatchetUser[] => {
  return Array.from(userData.values())
}

// Get all pubkeys from the doubleRatchetUsers Set (for cleanup)
export const getAllDoubleRatchetUserPubkeys = (): string[] => {
  return Array.from(doubleRatchetUsers)
}

export const getDoubleRatchetUsersCount = () => {
  return doubleRatchetUsers.size
}
