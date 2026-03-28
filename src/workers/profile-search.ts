/**
 * Profile Search Index
 *
 * Fuse.js-based search index for user profiles.
 * Used by relay-worker to handle search queries.
 */
import Fuse from "fuse.js"
import type {SearchResult} from "../utils/profileSearchData"

const FUSE_KEYS = ["name", "aliases", "nip05", "pubKey"]

let searchIndex: Fuse<SearchResult> = new Fuse<SearchResult>([], {
  keys: FUSE_KEYS,
  includeScore: true,
})

const latestProfileTimestamps = new Map<string, number>()

export function updateSearchIndex(profile: SearchResult) {
  if (!profile.name) return

  const lastSeen = latestProfileTimestamps.get(profile.pubKey) || 0
  if (profile.created_at && profile.created_at <= lastSeen) return

  if (profile.created_at) {
    latestProfileTimestamps.set(profile.pubKey, profile.created_at)
  }
  searchIndex.remove((existingProfile) => existingProfile.pubKey === profile.pubKey)
  searchIndex.add({...profile, name: String(profile.name)})
}

export function initSearchIndex(profiles: SearchResult[]) {
  const validProfiles = profiles.filter((p) => p.name)
  searchIndex = new Fuse<SearchResult>(validProfiles, {
    keys: FUSE_KEYS,
    includeScore: true,
  })
  latestProfileTimestamps.clear()
  for (const profile of validProfiles) {
    if (profile.created_at) {
      latestProfileTimestamps.set(profile.pubKey, profile.created_at)
    }
  }
}

export function searchProfiles(
  query: string
): Array<{item: SearchResult; score?: number}> {
  const results = searchIndex.search(query)
  return results.map((r) => ({item: r.item, score: r.score}))
}
