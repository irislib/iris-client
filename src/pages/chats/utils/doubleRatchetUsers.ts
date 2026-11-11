import {UserProfile} from "@/lib/nostr"
import {getMainThreadDb} from "@/lib/nostr/db"
import {nostr} from "@/utils/nostrClient"
import debounce from "lodash/debounce"
import Fuse from "fuse.js"
import {KIND_METADATA, DEBUG_NAMESPACES} from "@/utils/constants"
import {shouldHideUser} from "@/utils/visibility"
import {createDebugLogger} from "@/utils/createDebugLogger"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UI_CHAT)

export interface DoubleRatchetUser {
  pubkey: string
  profile: UserProfile
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

/** Coalesce bursts of arriving profiles into one index rebuild. */
const PROFILE_INDEX_REFRESH_MS = 300

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

    const sub = nostr().subscribe(
      {kinds: [KIND_METADATA], authors: usersWithoutProfiles},
      {closeOnEose: true}
    )

    // Rebuild from the profile store as profiles arrive, without triggering new
    // lookups; a relay that never finishes must not keep found users unsearchable.
    const refresh = debounce(async () => {
      await updateUserDataFromCache()
      notifySubscribers()
    }, PROFILE_INDEX_REFRESH_MS)
    sub.on("event", refresh)
    sub.on("eose", () => {
      isFetchingProfiles = false
      refresh()
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

export const getDoubleRatchetUsersCount = () => {
  return doubleRatchetUsers.size
}
