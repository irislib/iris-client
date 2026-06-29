import {NDKUserProfile} from "@/lib/ndk"
import {getMainThreadDb} from "@/lib/ndk-cache/db"
import {handleProfile} from "@/utils/profileSearch"
import {ndk} from "@/utils/ndk"
import debounce from "lodash/debounce"
import Fuse from "fuse.js"
import {KIND_METADATA, DEBUG_NAMESPACES} from "@/utils/constants"
import {shouldHideUser} from "@/utils/visibility"
import {createDebugLogger} from "@/utils/createDebugLogger"

const {log, warn} = createDebugLogger(DEBUG_NAMESPACES.UI_CHAT)

export interface DoubleRatchetUser {
  pubkey: string
  profile: NDKUserProfile
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

export interface ReconcileDoubleRatchetUserPubkeysOptions {
  currentPubkeys: Iterable<string>
  candidatePubkeys: Iterable<string>
  ownPubkey?: string
}

export const reconcileDoubleRatchetUserPubkeys = ({
  candidatePubkeys,
  ownPubkey,
}: ReconcileDoubleRatchetUserPubkeysOptions): string[] => {
  const own = ownPubkey?.trim()
  const seen = new Set<string>()
  const next: string[] = []

  for (const pubkey of candidatePubkeys) {
    const normalized = pubkey.trim()
    if (!normalized || normalized === own || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    next.push(normalized)
  }

  return next
}

export const replaceDoubleRatchetUserCandidates = (
  candidatePubkeys: Iterable<string>,
  ownPubkey?: string
) => {
  const nextPubkeys = new Set(
    reconcileDoubleRatchetUserPubkeys({
      currentPubkeys: doubleRatchetUsers,
      candidatePubkeys,
      ownPubkey,
    })
  )
  let changed = false

  for (const pubkey of Array.from(doubleRatchetUsers)) {
    if (nextPubkeys.has(pubkey)) continue
    doubleRatchetUsers.delete(pubkey)
    userData.delete(pubkey)
    changed = true
  }

  for (const pubkey of nextPubkeys) {
    if (doubleRatchetUsers.has(pubkey)) continue
    doubleRatchetUsers.add(pubkey)
    changed = true
  }

  if (changed) {
    updateDoubleRatchetSearchIndex()
  }

  return doubleRatchetUsers.size
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

// Track if we're currently fetching profiles to prevent infinite loops
let isFetchingProfiles = false

// Update user data map from Dexie cache
const updateUserDataFromCache = async () => {
  const db = getMainThreadDb()
  const pubkeys = Array.from(doubleRatchetUsers)

  const updatedUsers = new Map<string, DoubleRatchetUser>()

  // Batch fetch profiles from Dexie
  const profiles = await db.profiles.bulkGet(pubkeys)

  profiles.forEach((profile, index) => {
    if (profile) {
      updatedUsers.set(pubkeys[index], {
        pubkey: pubkeys[index],
        profile,
      })
    }
  })

  userData.clear()
  updatedUsers.forEach((user) => userData.set(user.pubkey, user))
  recreateSearchIndex()

  return pubkeys.filter((_, index) => !profiles[index])
}

// Update the search index with new user data (internal)
const updateDoubleRatchetSearchIndexImmediate = async () => {
  const usersWithoutProfiles = await updateUserDataFromCache()
  log("Updated double ratchet search index", userData.size)

  // If we have users without profiles and we're not already fetching, fetch them
  if (usersWithoutProfiles.length > 0 && !isFetchingProfiles) {
    log("Fetching profiles for", usersWithoutProfiles.length, "users")
    isFetchingProfiles = true

    const sub = ndk().subscribe(
      {kinds: [KIND_METADATA], authors: usersWithoutProfiles},
      {closeOnEose: true}
    )

    sub.on("event", (event) => {
      if (event.kind === KIND_METADATA) {
        try {
          const profile = JSON.parse(event.content)
          profile.created_at = event.created_at
          handleProfile(event.pubkey, profile)
        } catch (e) {
          warn("Failed to parse profile for", event.pubkey, e)
        }
      }
    })

    // Update index once when subscription ends, without triggering new lookups
    sub.on("eose", async () => {
      isFetchingProfiles = false
      await updateUserDataFromCache()
      notifySubscribers()
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
  // Filter out hidden users from search results
  return results
    .map((result) => result.item)
    .filter((user) => !shouldHideUser(user.pubkey))
}

// Get all double ratchet users
export const getAllDoubleRatchetUsers = (): DoubleRatchetUser[] => {
  return Array.from(userData.values()).filter((user) => !shouldHideUser(user.pubkey))
}

// Get all pubkeys from the doubleRatchetUsers Set (for cleanup)
export const getAllDoubleRatchetUserPubkeys = (): string[] => {
  return Array.from(doubleRatchetUsers)
}

export const getDoubleRatchetUsersCount = () => {
  return doubleRatchetUsers.size
}
