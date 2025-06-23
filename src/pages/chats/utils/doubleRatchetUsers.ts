import {NDKUserProfile} from "@nostr-dev-kit/ndk"
import socialGraph from "@/utils/socialGraph"
import {profileCache} from "@/utils/memcache"
import {ndk} from "@/utils/ndk"
import Fuse from "fuse.js"

export interface DoubleRatchetUser {
  pubkey: string
  profile: NDKUserProfile
}

// Fuse.js search index
let fuse: Fuse<DoubleRatchetUser> | null = null

const doubleRatchetUsers: Set<string> = new Set()
const userData: Map<string, DoubleRatchetUser> = new Map()
let subscribed = false

// Update the search index with new user data
export const updateDoubleRatchetSearchIndex = (pubkey: string) => {
  // Update all users' profiles in the map
  const updatedUsers = new Map<string, DoubleRatchetUser>()

  // First add/update the new user
  const profile = profileCache.get(pubkey)
  if (profile) {
    updatedUsers.set(pubkey, {
      pubkey,
      profile,
    })
  }

  // Then update all existing users' profiles
  for (const [key] of userData) {
    const updatedProfile = profileCache.get(key)
    if (updatedProfile) {
      updatedUsers.set(key, {
        pubkey: key,
        profile: updatedProfile,
      })
    }
  }

  // Replace the old map with the updated one
  userData.clear()
  updatedUsers.forEach((user) => userData.set(user.pubkey, user))

  // Recreate the Fuse.js index
  fuse = new Fuse(Array.from(userData.values()), {
    keys: ["profile.name", "profile.display_name", "profile.username", "profile.nip05"],
    threshold: 0.3,
    includeScore: true,
  })

  console.log("Updated double ratchet search index", userData.size)
}

// Search for double ratchet users using the Fuse.js index
export const searchDoubleRatchetUsers = (query: string): DoubleRatchetUser[] => {
  if (!fuse || !query.trim()) {
    return []
  }

  const results = fuse.search(query)
  return results.map((result) => result.item)
}

// Get a user from the map
export const getDoubleRatchetUser = (pubkey: string): DoubleRatchetUser | undefined => {
  return userData.get(pubkey)
}

export const subscribeToDoubleRatchetUsers = () => {
  if (!subscribed) {
    console.log("Subscribing to double ratchet users")
    subscribed = true
    const sub = ndk().subscribe({
      kinds: [30078],
      authors: Array.from(socialGraph().getUsersByFollowDistance(1)),
      "#l": ["double-ratchet/invites"],
    })
    sub.on("event", (event) => {
      console.log("Received event", event)
      if (event.kind !== 30078) {
        return
      }
      if (event.tags.length > 0) {
        doubleRatchetUsers.add(event.pubkey)
        updateDoubleRatchetSearchIndex(event.pubkey)
      } else {
        doubleRatchetUsers.delete(event.pubkey)
        userData.delete(event.pubkey)
      }
    })
  }
  return doubleRatchetUsers
}

export const getDoubleRatchetUsersCount = () => {
  return doubleRatchetUsers.size
}
